/**
 * PUT /api/ledger/weeks/:weekStart —— 设置/修改某周预算（单位：分）
 *
 * 路径里没有 wish_id，因此 body 必填 wish_id（第 5 轮补充约定，见 docs/04 §0.1.4）。
 * 仅当前及未来周可改；历史周只读。预算必须是非负整数分，上限 200000 分。
 * 首周默认值由 q4 五问档位在签约时推算，用户可随时覆盖；修改按 updated_at 单行 CAS。
 * 支持 Idempotency-Key；同键同内容重放返回首次结果，同键不同内容 409。
 *
 * 调用示例：
 *   curl -X PUT 'https://<site>/functions/v1/app/api/ledger/weeks/2026-05-18' \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 4c1c7d88-1f7a-4e6b-8f0a-9c2d3e4f5a6b' \
 *        -d '{"wish_id":"<wish_uuid>","budget_cents":6000}'
 *
 * 返回 200：{ code: 0, data: { week: LedgerWeek, totals, progress, notice } }
 * 错误：400 invalid_parameter / 400 wish_not_active / 400 week_not_in_contract /
 *       400 week_not_editable / 401 invalid_token / 403 wish_forbidden / 404 wish_not_found /
 *       409 ledger_week_conflict / 409 idempotency_key_reuse
 */
import { internal } from '../../../../lib/errors.ts';
import { ok } from '../../../../lib/respond.ts';
import { validate, type FieldSpec } from '../../../../lib/validate.ts';
import { MAX_WEEKLY_BUDGET_INPUT_CENTS, parseWeekStart, setWeekBudget } from '../../../../domain/ledger.ts';
import { requireAuthor } from '../../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/ledger/weeks/:weekStart',
  method: 'PUT',
  auth: 'bearer',
  operation: 'ledger.set_week_budget',
  idempotent: 'optional',
  maxBodyBytes: 1024,
};

const BODY: Record<string, FieldSpec> = {
  wish_id: { type: 'uuid', required: true },
  budget_cents: { type: 'money', required: true, maxCents: MAX_WEEKLY_BUDGET_INPUT_CENTS },
};

export default async function ledgerWeekBudget(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const weekStart = parseWeekStart(ctx.params.weekStart);
  const body = validate<Record<string, unknown>>(ctx.body, BODY);

  const wish = await requireAuthor(ctx.db, String(body.value.wish_id), principal.userId);
  const result = await setWeekBudget(
    ctx.db,
    wish,
    weekStart,
    Number(body.value.budget_cents),
    ctx.now,
  );
  return ok({
    week: result.week,
    totals: result.totals,
    progress: result.progress,
    notice: '预算已更新，从这一周起生效。',
  }, ctx.requestId);
}