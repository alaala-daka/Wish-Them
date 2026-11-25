/**
 * PUT /api/wishes/:id/answers —— 保存五问答案（部分提交）
 *
 * 语义：提交的字段整体替换，未提交的保持原值；五问全部有值即 five_questions_done = true。
 * 明文只存在于本次请求内存，落库为 AES-256-GCM 密文（AAD = wish_id，见 lib/crypto.ts#encryptField），
 * 因此本接口的响应不回显答案，幂等存档里也只有计数与时间戳。
 * 仅 draft 可改：签署后答案锁定，避免任务与结算的依据被事后篡改。
 *
 * 调用示例：
 *   curl -X PUT https://<site>/functions/v1/app/api/wishes/<wish_id>/answers \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 8c1f2d5e-9a7b-43c6-8e1f-2d5e9a7b3c64' \
 *        -d '{"q1":"最怕她腿疼加重","q2":"基本一个人待着"}'
 *
 * 返回 200：{ code: 0, data: { answered: ['q1','q2'], five_questions_done: false,
 *            completed_at: null, updated_at, encrypted_stored: true } }
 * 错误：400 invalid_parameter（含 details.fields）/ 400 answers_locked / 401 invalid_token
 *       403 wish_forbidden / 404 wish_not_found / 409 idempotency_key_reuse / 422 no_op
 */
import { badRequest, internal, unprocessable } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam, validate, type FieldSpec } from '../../../lib/validate.ts';
import { ANSWER_COLUMNS, requireAuthor, saveAnswers, type AnswerMeta } from '../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/answers',
  method: 'PUT',
  auth: 'bearer',
  operation: 'wish.answers',
  // 同 body 重复提交结果一致；带键可挡住连点，不带键也允许（PUT 天然幂等）
  idempotent: 'optional',
  maxBodyBytes: 4096,
};

const BODY: Record<string, FieldSpec> = Object.fromEntries(
  Object.keys(ANSWER_COLUMNS).map((field) => [field, { type: 'text', min: 1, max: 200 } as FieldSpec]),
);

/** 动态问卷的粗粒度档位：只接受白名单枚举，避免客户端塞入任意列值 */
const META_VALUES: Record<keyof AnswerMeta, readonly string[]> = {
  giftCategory: ['body', 'sleep', 'lonely', 'study', 'emotion', 'life'],
  aloneLevel: ['high', 'medium', 'low'],
  lastHome: ['recent', 'week', 'month', 'long'],
  travelBand: ['same_city', 'near', 'far', 'unknown'],
  costBand: ['under_100', '100_299', '300_599', '600_999', '1000_plus'],
  disposableBand: ['under_100', '100_299', '300_599', '600_999', '1000_plus'],
};

function parseMeta(raw: unknown): AnswerMeta {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('invalid_parameter', 'meta 必须是对象。', { fields: { meta: 'must be an object' } });
  }
  const source = raw as Record<string, unknown>;
  const meta: AnswerMeta = {};
  const errors: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(META_VALUES) as Array<[keyof AnswerMeta, readonly string[]]>) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !allowed.includes(value)) {
      errors[`meta.${key}`] = `must be one of ${allowed.join('|')}`;
      continue;
    }
    meta[key] = value;
  }
  if (Object.keys(errors).length > 0) {
    throw badRequest('invalid_parameter', '问卷档位校验未通过。', { fields: errors });
  }
  return meta;
}

export default async function wishAnswers(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const body = validate<Record<string, unknown>>(ctx.body, BODY);
  if (body.present.length === 0) throw unprocessable('no_op', '至少回答一个问题。');

  // 先判作者再判状态：越权要明确 403，不能被「已锁定」掩盖成 400
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const result = await saveAnswers(
    ctx.db,
    ctx.config,
    wish,
    body.value as Record<string, string>,
    ctx.now,
    parseMeta((ctx.body as Record<string, unknown> | null)?.meta),
  );
  return ok({ ...result, encrypted_stored: true }, ctx.requestId);
}