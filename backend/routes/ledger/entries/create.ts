/**
 * POST /api/ledger/entries —— 追加一条收支流水（不可修改）
 *
 * 路径里没有 wish_id，因此 body 必填 wish_id（第 5 轮补充约定，见 docs/04 §0.1.4）。
 * - type=expense：非必要支出，0~200000 分，直接扣减当周结余；超预算不拦提交，结余记 0 并提示；
 * - type=saved：手记省下一笔，1~200000 分，直接累加进愿望基金；
 * - type=earning：兼职收入，1~100000 分，必须关联本愿签内状态 done/made_up 的钱任务，
 *   且该任务与本条流水落在同一自然周；proof_id 可选（传入则须为 purpose=ledger_proof）。
 * 支出可选 proof_id，也可不传；每条记录只追加，不提供修改/删除。
 *
 * 调用示例：
 *   curl -X POST 'https://<site>/functions/v1/app/api/ledger/entries' \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 8e1f0a52-6b3c-4d8e-9f10-2a3b4c5d6e7f' \
 *        -d '{"wish_id":"<wish_uuid>","week_start":"2026-05-18","type":"expense",
 *             "amount_cents":1234,"note":"给TA买了花","proof_id":"<file_uuid>"}'
 *
 * 返回 200：{ code: 0, data: { entry: LedgerEntry, week: LedgerWeek, totals, progress, notice } }
 * 错误：400 invalid_parameter / 400 wish_not_active / 400 week_not_in_contract / 400 week_not_started /
 *       400 earning_task_required / 400 earning_task_not_done / 400 earning_week_mismatch /
 *       400 duplicate_earning_link / 400 proof_not_found / 400 proof_not_ready /
 *       400 proof_purpose_mismatch / 400 proof_wish_mismatch / 403 wish_forbidden / 403 proof_forbidden /
 *       403 task_forbidden / 404 wish_not_found / 404 task_not_found /
 *       409 idempotency_key_reuse / 409 ledger_entry_failed
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { validate, type FieldSpec } from '../../../lib/validate.ts';
import { MAX_EXPENSE_CENTS, addLedgerEntry, parseWeekStart, type EntryType } from '../../../domain/ledger.ts';
import { requireAuthor } from '../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/ledger/entries',
  method: 'POST',
  auth: 'bearer',
  operation: 'ledger.add_entry',
  idempotent: 'optional',
  maxBodyBytes: 2048,
};

const BODY: Record<string, FieldSpec> = {
  wish_id: { type: 'uuid', required: true },
  week_start: { type: 'date', required: true },
  type: { type: 'enum', required: true, values: ['expense', 'earning', 'saved'] },
  amount_cents: { type: 'money', required: true, maxCents: MAX_EXPENSE_CENTS },
  note: { type: 'text', min: 0, max: 60 },
  proof_id: { type: 'uuid' },
  task_id: { type: 'uuid' },
};

export default async function ledgerEntryCreate(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const body = validate<Record<string, unknown>>(ctx.body, BODY);
  const weekStart = parseWeekStart(String(body.value.week_start));

  const wish = await requireAuthor(ctx.db, String(body.value.wish_id), principal.userId);
  const result = await addLedgerEntry(
    ctx.db,
    principal,
    wish,
    {
      weekStart,
      type: String(body.value.type) as EntryType,
      amountCents: Number(body.value.amount_cents),
      note: body.value.note === undefined ? '' : String(body.value.note),
      proofId: body.value.proof_id === undefined ? null : String(body.value.proof_id),
      taskId: body.value.task_id === undefined ? null : String(body.value.task_id),
    },
    ctx.now,
  );
  return ok({
    entry: result.entry,
    week: result.week,
    totals: result.totals,
    progress: result.progress,
    notice: result.notice,
  }, ctx.requestId);
}