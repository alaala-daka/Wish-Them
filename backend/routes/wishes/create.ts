/**
 * POST /api/wishes —— 创建愿签草稿（PRD B-01~B-05）
 *
 * 关键词规则识别六类愿望（domain/rules.ts#classifyWish，不调用 AI），初始状态 draft，归属当前账号。
 * 必须带 Idempotency-Key：连点/弱网重试只会得到一个草稿。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/wishes \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 3f7a1c2e-9b4d-4e6a-8c1f-2d5e9a7b3c64' \
 *        -d '{"relation":"姥姥","nickname":"姥姥","pronoun":"she","wish_text":"姥姥的腿疼能轻一些，别再一个人在家扛着。"}'
 *
 * 返回 201：{ code: 0, data: { wish: {...status:'draft', wish_type:'body', classifier_confidence_bps} } }
 * 错误：400 invalid_parameter（含 details.fields）/ 400 idempotency_key_required / 401 invalid_token
 *       409 idempotency_key_reuse / 429 wish_create_limited
 */
import { internal } from '../../lib/errors.ts';
import { created } from '../../lib/respond.ts';
import { validate, type FieldSpec } from '../../lib/validate.ts';
import { createWish, toWishDto } from '../../domain/wish.ts';
import { PRONOUNS, RELATIONS } from '../../domain/rules.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes',
  method: 'POST',
  auth: 'bearer',
  operation: 'wish.create',
  // 创建是「不可重复」的写操作：没有幂等键就无法区分重试与再许一个愿
  idempotent: 'required',
  maxBodyBytes: 4096,
};

const BODY: Record<string, FieldSpec> = {
  relation: { type: 'enum', values: RELATIONS, required: true },
  nickname: { type: 'string', min: 1, max: 8 },
  pronoun: { type: 'enum', values: PRONOUNS },
  wish_text: { type: 'string', min: 1, max: 120, required: true },
};

export default async function wishCreate(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const body = validate<Record<string, unknown>>(ctx.body, BODY);
  const relation = String(body.value.relation);
  const wish = await createWish(ctx.db, ctx.config, principal, {
    relation,
    // 称呼缺省就用关系本身（「姥姥」），不强制用户再输一遍
    nickname: body.value.nickname === undefined ? relation : String(body.value.nickname),
    pronoun: body.value.pronoun === undefined ? 'they' : String(body.value.pronoun),
    wishText: String(body.value.wish_text),
  }, ctx.now);
  return created({ wish: toWishDto(wish) }, ctx.requestId);
}