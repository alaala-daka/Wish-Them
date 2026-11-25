/**
 * 金钱任务打卡金额 → 账本流水。
 *
 * 单独成文件的原因：checkin.ts 需要写 ledger_entries，而 ledger.ts 又 import 了 checkin.ts
 * 的 bumpWishVersion/requireProofFile；把这段最小写入抽出来，避免 checkin ↔ ledger 循环依赖。
 *
 * 口径：
 * - money_kind = save → entry_kind = saved；earn → entry_kind = earned；
 * - 一个任务只保留一条“打卡带出”的有效流水，重复打卡/补卡原地更新金额；
 * - 手工记账仍然是 manual，不在这里处理。
 */

import { affected, firstAs, write } from '../lib/db.ts';
import { uuid } from '../lib/id.ts';
import type { DbClient, DbRow } from '../lib/types.ts';
import type { TaskRow } from './task.ts';
import type { WishRow } from './wish.ts';
import type { CheckinRow } from './checkin.ts';

export type CheckinAmountKind = 'saved' | 'earned';

export function amountKindOfMoneyKind(moneyKind: string): CheckinAmountKind {
  return moneyKind === 'earn' ? 'earned' : 'saved';
}

/** 金额必须是整数分；调用方负责“金钱任务必填”的产品校验 */
export function normalizeAmountCents(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export async function recordCheckinAmount(
  db: DbClient,
  wish: WishRow,
  task: TaskRow,
  checkin: CheckinRow,
  amountCents: number,
  now: Date,
): Promise<void> {
  if (String(task.side ?? '') !== 'money') return;
  const kind = amountKindOfMoneyKind(String(task.money_kind ?? ''));
  const wishId = String(wish.id);
  const taskId = String(task.id);
  const timestamp = now.toISOString();
  const existing = await firstAs<DbRow & { id: string }>(
    db.from('ledger_entries')
      .select('id,amount_cents,entry_kind')
      .eq('wish_id', wishId)
      .eq('task_id', taskId)
      .eq('entry_kind', kind)
      .isNull('revoked_at')
      .limit(1),
    'read task amount entry',
  );

  if (existing) {
    if (Number(existing.amount_cents ?? 0) === amountCents) return;
    await affected(
      db.from('ledger_entries')
        .update({ amount_cents: amountCents, checkin_id: String(checkin.id), updated_at: timestamp })
        .eq('id', String(existing.id)),
      'update task amount entry',
    );
    return;
  }

  await write(
    db.from('ledger_entries').insert({
      id: uuid(),
      wish_id: wishId,
      user_id: String(wish.user_id ?? ''),
      week_start: String(task.week_start ?? ''),
      entry_kind: kind,
      amount_cents: amountCents,
      note: kind === 'saved' ? '钱任务省下' : '钱任务收入',
      proof_file_id: checkin.proof_file_id ?? null,
      task_id: taskId,
      checkin_id: String(checkin.id),
      source: 'checkin',
      revoked_at: null,
      server_ts: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    }).select('id'),
    'insert task amount entry',
  );
}
