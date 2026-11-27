/**
 * GET /api/wishes/:id/ledger —— 账本总览（默认当前自然周，可查契约内指定周）
 *
 * 只返回金额与进度：周预算、本周支出、本周兼职收入、本周结余、累计兑现，以及逐周明细。
 * 结算前绝不返回礼物名称、价格、匹配结果；这些字段来自 settlements，不在本接口出参里。
 * 仅愿签作者可读；非作者 403。自然周 = 周一 04:00 至下周一 03:59（Asia/Shanghai）。
 *
 * 调用示例：
 *   curl 'https://<site>/functions/v1/app/api/wishes/<wish_id>/ledger?week_start=2026-05-18' \
 *        -H 'authorization: Bearer <access_token>'
 *
 * 返回 200：{ code: 0, data: { wish_id, week: LedgerWeek, weeks: [LedgerWeek],
 *            totals: { contract_weeks, counted_weeks, budget_cents, spent_cents, saved_cents,
 *                      income_cents, realized_cents, current_week_start },
 *            progress: { over_budget, budget_used_bps, counted_weeks, contract_weeks, message } } }
 * 错误：400 invalid_parameter（id / week_start 非周一）/ 400 wish_not_active /
 *       400 week_not_in_contract / 401 invalid_token / 403 wish_forbidden / 404 wish_not_found
 */
import { internal } from '../../../../lib/errors.ts';
import { ok } from '../../../../lib/respond.ts';
import { parseUuidParam } from '../../../../lib/validate.ts';
import { parseWeekStart, readLedger } from '../../../../domain/ledger.ts';
import { requireAuthor } from '../../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/ledger',
  method: 'GET',
  auth: 'bearer',
  operation: 'wish.ledger',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function wishLedger(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);

  const rawWeek = new URL(ctx.request.url).searchParams.get('week_start');
  const weekStart = rawWeek === null ? null : parseWeekStart(rawWeek);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const view = await readLedger(ctx.db, wish, weekStart, ctx.now);
  return ok(view, ctx.requestId);
}