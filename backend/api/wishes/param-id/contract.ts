/**
 * POST /api/wishes/:id/contract —— 签署契约并一次性生成全部任务
 *
 * 语义：draft → active，写入 days / start_date / end_date，并在同一请求里落库全部天数的任务
 *       （每日 2 条必做，周六周日额外 1 条可选钱任务；day_index 从 0 起）。
 * 重复签署幂等返回成功：以首签的天数与开始日为准，缺任务就补齐（派生 id + insertIfAbsent）。
 * 恢复码复用账号全局的那一个，本接口不再生成、也不再展示明文，只给提示文案。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/wishes/<wish_id>/contract \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 2d5e9a7b-3c64-4f7a-9c2e-9b4d4e6a8c1f' \
 *        -d '{"days":7}'
 *
 * 返回 200：{ code: 0, data: { wish: {...status:'active'}, tasks: [{day_index:0,type:'ta',title,status:'pending'}],
 *            task_summary: {days,total,must,optional,ta,self,money}, first_sign: true, recovery_code_notice } }
 * 错误：400 invalid_parameter（days 非 7/14/30）/ 400 wish_not_draft / 400 answers_incomplete
 *       401 invalid_token / 403 wish_forbidden / 404 wish_not_found
 *       409 wish_state_conflict / 503 task_pool_empty（种子未导入）
 */
import { badRequest, internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam, validate, type FieldSpec } from '../../../lib/validate.ts';
import { requireAuthor, signContract, toWishDto } from '../../../domain/wish.ts';
import { toTaskDto } from '../../../domain/task.ts';
import { CONTRACT_DAYS, DEFAULT_CONTRACT_DAYS } from '../../../domain/rules.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/contract',
  method: 'POST',
  auth: 'bearer',
  operation: 'wish.contract',
  idempotent: 'optional',
  maxBodyBytes: 1024,
};

const BODY: Record<string, FieldSpec> = {
  days: { type: 'int' },
};

export default async function wishContract(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const body = validate<Record<string, unknown>>(ctx.body, BODY);
  const days = body.value.days === undefined ? DEFAULT_CONTRACT_DAYS : Number(body.value.days);
  if (!(CONTRACT_DAYS as readonly number[]).includes(days)) {
    throw badRequest('invalid_parameter', '契约天数只能是 7、10、14 或 30；产品默认 10 天。', {
      fields: { days: `must be one of ${CONTRACT_DAYS.join('|')}` },
    });
  }

  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const result = await signContract(ctx.db, wish, days, ctx.now);
  return ok({
    wish: toWishDto(result.wish),
    tasks: result.tasks.map(toTaskDto),
    task_summary: result.summary,
    first_sign: result.first_sign,
    makeup_ticket: result.makeup_ticket,
    recovery_code_notice: principal.isDemo
      ? '演示账号没有恢复码，演示数据只在当前演示会话内有效。'
      : '愿签复用账号的全局恢复码，这里不再单独生成；恢复码只在创建账号时展示过一次，请确认已保存。',
  }, ctx.requestId);
}