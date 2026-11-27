/**
 * POST /api/wishes/:id/settle —— 触发结算（截止日次日 04:00 之后）
 *
 * 前置：仅作者（403）；仅 active 可结算（400 wish_not_active）；未到期 400 settle_too_early；
 *       已结算的重复调用直接返回已有结算结果（already_settled=true），不重新计算。
 * 执行：active → settling → settled（status + version 单行 CAS），任务/账本实时统计后落 settlements 快照。
 * 请求体可为空对象 {}（需 content-type: application/json）。
 * 支持 Idempotency-Key：同键重放返回首次存档响应。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/wishes/<wish_id>/settle \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 3f6a2c1d-8e4b-4a7c-9d2f-1b3c5e7a9d0f' -d '{}'
 *
 * 返回 200：{ code: 0, data: { settlement: { wish_id, settlement_version, first_act, second_act, extension },
 *            already_settled: false } }
 * 错误：400 invalid_parameter / 400 wish_not_active / 400 settle_too_early /
 *       403 wish_forbidden / 404 wish_not_found / 409 settlement_in_progress /
 *       409 wish_state_conflict / 409 settlement_missing / 503 reward_pool_empty
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam } from '../../../lib/validate.ts';
import { requireAuthor } from '../../../domain/wish.ts';
import { settleWish } from '../../../domain/settlement.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/settle',
  method: 'POST',
  auth: 'bearer',
  operation: 'wish.settle',
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function wishSettle(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const result = await settleWish(ctx.db, ctx.config, wish, ctx.now);
  return ok({ settlement: result.settlement, already_settled: result.already_settled }, ctx.requestId);
}