/**
 * POST /api/wishes/:id/extend —— 续期 7 天（每个愿签仅一次）
 *
 * 规则：仅 settled 且结局为 cyber_only / unrealized 可续期；double_realized 返回 400 extend_not_allowed；
 *       已续期过一次返回 400 extend_limit_reached；续期后回到 active、截止日 +7 天，
 *       补生成新增天数的任务（派生 id 自动跳过已有任务），并补发对应自然周的补卡券。
 * 并发：`.eq(status,'settled').eq(renew_count,0)` 单行 CAS，第二次调用必然被拦截。
 * 请求体可为空对象 {}（需 content-type: application/json）。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/wishes/<wish_id>/extend \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' -d '{}'
 *
 * 返回 200：{ code: 0, data: { wish, new_end_date, added_tasks, makeup_tickets, settle_open_at } }
 * 错误：400 wish_not_settled / 400 extend_not_allowed / 400 extend_limit_reached /
 *       403 wish_forbidden / 404 wish_not_found / 409 wish_state_conflict
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam, validate } from '../../../lib/validate.ts';
import { MAX_EXTEND_DAYS, MIN_EXTEND_DAYS } from '../../../domain/rules.ts';
import { requireAuthor, toWishDto } from '../../../domain/wish.ts';
import { extendWish } from '../../../domain/settlement.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/extend',
  method: 'POST',
  auth: 'bearer',
  operation: 'wish.extend',
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function wishExtend(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const body = validate<{ days?: number }>(ctx.body ?? {}, {
    days: { type: 'int', min: MIN_EXTEND_DAYS, max: MAX_EXTEND_DAYS },
  });
  const days = body.value.days === undefined ? MIN_EXTEND_DAYS : Number(body.value.days);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const result = await extendWish(ctx.db, wish, days, ctx.now);
  return ok({
    wish: toWishDto(result.wish),
    new_end_date: result.new_end_date,
    days: result.days,
    added_tasks: result.added_tasks,
    makeup_tickets: result.makeup_tickets,
    settle_open_at: result.settle_open_at,
  }, ctx.requestId);
}