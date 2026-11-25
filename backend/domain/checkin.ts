/**
 * 打卡与补卡（第 4 轮）。
 *
 * 状态流转（只前进，不回退）：
 *   pending --打卡--> done
 *   pending --跨过 04:00 仍未完成--> missed（惰性日界，见 domain/task.ts#sweepMissedTasks）
 *   missed  --补卡券--> made_up
 *
 * 一致性（平台无事务）：
 * - 任务状态用单行 CAS（`.eq('status', ...)` + affected）；0 行即并发或已处理，回读真实状态再判定；
 * - 一个任务一条打卡由 checkins 表级 UNIQUE(task_id) 兜底，重复提交原地更新（要求允许覆盖备注与图片）；
 * - 补卡券按「愿签 × 自然周」唯一：先用单行 CAS 改成 used，再改任务状态；任务 CAS 失败则尽力把券放回；
 * - 任何改变任务/打卡的写操作都给 wishes.version +1（读-改-CAS，冲突重读），供第 5 轮结算判定。
 *
 * 业务简化（本轮明确口径）：提交即完成，服务端不审核图片内容、不做 AI 验收；
 * 只校验 files 行属于当前账号、用途匹配（打卡 / 账本）且 status=ready。
 */

import { affected, first, firstAs, write } from '../lib/db.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { uuid } from '../lib/id.ts';
import { enforceWindow, minuteWindow } from '../lib/quota.ts';
import { dayIndexOf, makeupExpiresAt, productDate, weekStartOf } from '../lib/time.ts';
import { findTask, sweepMissedTasks } from './task.ts';
import { amountKindOfMoneyKind, normalizeAmountCents, recordCheckinAmount } from './task-money.ts';
import type { TaskRow } from './task.ts';
import type { WishRow } from './wish.ts';
import type { AppConfig, DbClient, DbRow, Principal } from '../lib/types.ts';

export type FileRow = DbRow & { id: string };
export type CheckinRow = DbRow & { id: string };
export type MakeupTicketRow = DbRow & { id: string };

export interface CheckinInput {
  proofId: string;
  note: string;
  /** 金钱任务必填：用户自填的实际省下/挣到金额（分） */
  amountCents?: number;
}

export interface CheckinOutcome {
  task: TaskRow;
  checkin: CheckinRow;
  /** true = 该任务之前已经打过卡，本次覆盖了证明与备注 */
  already_done: boolean;
  notice: string;
}

export interface MakeupOutcome {
  task: TaskRow;
  checkin: CheckinRow;
  ticket: MakeupTicketRow;
}

/** 证明图片校验：必须存在、属于当前账号、ready、用途命中允许列表、绑定愿签一致 */
export async function requireProofFile(
  db: DbClient,
  userId: string,
  wishId: string,
  proofId: string,
  allowedPurposes: readonly string[] = ['checkin_proof'],
): Promise<FileRow> {
  const file = await firstAs<FileRow>(db.from('files').select('*').eq('id', proofId), 'read proof file');
  if (!file) throw badRequest('proof_not_found', '找不到这张证明图片，请重新上传。');
  if (String(file.user_id ?? '') !== userId) {
    throw forbidden('proof_forbidden', '只能使用自己上传的图片。');
  }
  if (file.deleted_at !== null && file.deleted_at !== undefined) {
    throw badRequest('proof_not_ready', '这张图片已失效，请重新上传。');
  }
  if (String(file.status ?? '') !== 'ready') {
    throw badRequest('proof_not_ready', '图片还在上传或校验中，请稍后再试。');
  }
  if (!allowedPurposes.includes(String(file.purpose ?? ''))) {
    throw badRequest('proof_purpose_mismatch', '这张图片不能用于当前操作。');
  }
  const boundWish = file.wish_id === null || file.wish_id === undefined ? '' : String(file.wish_id);
  if (boundWish !== '' && boundWish !== wishId) {
    throw badRequest('proof_wish_mismatch', '这张图片属于另一个愿签。');
  }
  return file;
}

export async function readCheckin(db: DbClient, taskId: string): Promise<CheckinRow | null> {
  return firstAs<CheckinRow>(db.from('checkins').select('*').eq('task_id', taskId), 'read checkin');
}

export interface OwnedTask {
  task: TaskRow;
  wish: WishRow;
}

/** 任务写路径：任务不存在 404；任务所属愿签不是自己的 → 403（本轮明确要求越权返回 403） */
export async function requireTaskAuthor(db: DbClient, taskId: string, userId: string): Promise<OwnedTask> {
  const task = await findTask(db, taskId);
  if (!task) throw notFound('task_not_found', '找不到这条任务。');
  const wish = await firstAs<WishRow>(
    db.from('wishes').select('*').eq('id', String(task.wish_id ?? '')),
    'read task wish',
  );
  if (!wish) throw notFound('wish_not_found', '找不到这条任务所属的愿签。');
  if (String(wish.user_id ?? '') !== userId) {
    throw forbidden('wish_forbidden', '只能操作自己愿签里的任务。');
  }
  return { task, wish };
}

/** 一个任务一条打卡：存在就原地覆盖，不存在就先 insertIfAbsent，撞唯一索引再改走 update */
async function storeCheckin(
  db: DbClient,
  task: TaskRow,
  wish: WishRow,
  proof: FileRow,
  input: CheckinInput,
  isMakeup: boolean,
  checkinDate: string,
  now: Date,
): Promise<CheckinRow> {
  const timestamp = now.toISOString();
  const taskId = String(task.id);
  const isMoney = String(task.side ?? '') === 'money';
  const amountCents = isMoney && input.amountCents !== undefined
    ? normalizeAmountCents(input.amountCents)
    : null;
  const amountKind = isMoney && amountCents !== null
    ? amountKindOfMoneyKind(String(task.money_kind ?? ''))
    : '';
  const checkinPatch = {
    wish_id: String(wish.id),
    user_id: String(wish.user_id ?? ''),
    proof_file_id: String(proof.id),
    proof_sha256: String(proof.sha256 ?? ''),
    note: input.note,
    is_makeup: isMakeup,
    channel: 'online',
    checkin_date: checkinDate,
    amount_cents: amountCents,
    amount_kind: amountKind,
    client_ts: null,
    server_ts: timestamp,
    revoked_at: null,
    updated_at: timestamp,
  };
  const existing = await readCheckin(db, taskId);
  if (existing) {
    const updated = await write(
      db.from('checkins').update(checkinPatch).eq('id', existing.id).select('*'),
      'update checkin',
    );
    if (updated.length === 1) return updated[0] as CheckinRow;
    throw conflict('checkin_conflict', '打卡记录刚被更新过，请刷新后重试。');
  }

  const checkinInsert = {
    id: uuid(),
    task_id: taskId,
    wish_id: String(wish.id),
    user_id: String(wish.user_id ?? ''),
    proof_file_id: String(proof.id),
    proof_sha256: String(proof.sha256 ?? ''),
    note: input.note,
    is_makeup: isMakeup,
    channel: 'online',
    checkin_date: checkinDate,
    amount_cents: amountCents,
    amount_kind: amountKind,
    client_ts: null,
    server_ts: timestamp,
    revoked_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const inserted = await write(
    db.from('checkins').insertIfAbsent(checkinInsert, { onConflict: 'task_id' }).select('*'),
    'insert checkin',
  );
  if (inserted.length === 1) return inserted[0] as CheckinRow;

  // 并发首提交：另一条请求先建了行，这里覆盖成本次提交
  const raced = await write(
    db.from('checkins').update(checkinPatch).eq('task_id', taskId).select('*'),
    'update raced checkin',
  );
  if (raced.length === 1) return raced[0] as CheckinRow;
  throw conflict('checkin_conflict', '打卡记录刚被更新过，请刷新后重试。');
}

/** wishes.version 是派生列一致性计数器：读-改-CAS，最多试 3 次，失败只当提示不影响打卡结果 */
export async function bumpWishVersion(db: DbClient, wishId: string, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await first(db.from('wishes').select('id,version').eq('id', wishId), 'read wish version');
    if (!row) return;
    const current = Number(row.version ?? 1);
    const hit = await affected(
      db.from('wishes').update({ version: current + 1, updated_at: timestamp }).eq('id', wishId).eq('version', current),
      'bump wish version',
    );
    if (hit === 1) return;
  }
}

/**
 * 打卡：只限今天的任务；重复提交转为覆盖证明与备注。
 * 调用方已完成「任务存在 + 愿签作者」校验（越权 403）。
 */
export async function checkinTask(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  task: TaskRow,
  wish: WishRow,
  input: CheckinInput,
  now: Date,
): Promise<CheckinOutcome> {
  const window = minuteWindow(now);
  await enforceWindow(db, 'checkins', {
    column: 'user_id',
    value: principal.userId,
    since: window.since,
    limit: config.checkinPerMinute,
    errorCode: 'checkin_rate_limited',
    message: '打卡太频繁了，请稍后再试。',
    resetAt: window.resetAt,
    now,
  });

  if (String(wish.status ?? '') !== 'active') {
    throw badRequest('wish_not_active', '愿签不在进行中，暂时不能打卡。', { status: wish.status });
  }

  const today = productDate(now);
  await sweepMissedTasks(db, String(wish.id), today, now);
  const current = await findTask(db, String(task.id));
  if (!current) throw notFound('task_not_found', '找不到这条任务。');

  if (String(current.task_date ?? '') !== today) {
    throw badRequest('task_not_today', '只能给今天的任务打卡；错过的任务请使用补卡。', {
      task_date: current.task_date,
      today,
    });
  }

  const status = String(current.status ?? '');
  const alreadyDone = status === 'done';
  if (!alreadyDone && status === 'missed') {
    throw badRequest('makeup_required', '这条任务已经错过，请使用补卡。', { task_date: current.task_date });
  }
  if (!alreadyDone && status !== 'pending') {
    throw badRequest('invalid_task_state', '这条任务当前不能打卡。', { status });
  }
  const amountCents = String(current.side ?? '') === 'money' && input.amountCents !== undefined
    ? normalizeAmountCents(input.amountCents)
    : undefined;
  if (amountCents === null) {
    throw badRequest('invalid_amount', '请填写这次实际省下或挣到的金额（整数元）。');
  }
  // 先验证证明图片，再改任务状态：否则坏 proof 会留下「done 但没有打卡记录」的证据缺失任务，
  // 而结算只看 tasks.status，会把它当成已完成。
  const proof = await requireProofFile(db, principal.userId, String(wish.id), input.proofId);
  if (!alreadyDone) {
    const timestamp = now.toISOString();
    const hit = await affected(
      db.from('tasks').update({ status: 'done', done_at: timestamp, updated_at: timestamp })
        .eq('id', String(current.id)).eq('status', 'pending'),
      'mark task done',
    );
    if (hit !== 1) {
      const raced = await findTask(db, String(current.id));
      if (!raced) throw notFound('task_not_found', '找不到这条任务。');
      if (String(raced.status ?? '') !== 'done') {
        throw badRequest('invalid_task_state', '这条任务刚刚被更新过，请刷新后重试。', { status: raced.status });
      }
    }
  }

  const checkin = await storeCheckin(
    db,
    current,
    wish,
    proof,
    { ...input, amountCents: amountCents ?? undefined },
    false,
    today,
    now,
  );
  if (amountCents !== undefined && amountCents !== null) {
    await recordCheckinAmount(db, wish, current, checkin, amountCents, now);
  }
  await bumpWishVersion(db, String(wish.id), now);

  const fresh = await findTask(db, String(current.id));
  if (!fresh) throw notFound('task_not_found', '找不到这条任务。');
  return {
    task: fresh,
    checkin,
    already_done: alreadyDone,
    notice: alreadyDone ? '这条任务已经打过卡，本次已覆盖证明与备注。' : '打卡完成。',
  };
}

/**
 * 补卡：仅 missed 任务、仅本周（自然周，周一 04:00 换周）、每周一张券。
 * 券先用 CAS 改成 used，再改任务状态；任务 CAS 失败时尽力把券放回。
 */
export async function makeUpTask(
  db: DbClient,
  principal: Principal,
  task: TaskRow,
  wish: WishRow,
  input: CheckinInput,
  now: Date,
): Promise<MakeupOutcome> {
  if (String(wish.status ?? '') !== 'active') {
    throw badRequest('wish_not_active', '愿签不在进行中，暂时不能补卡。', { status: wish.status });
  }

  const today = productDate(now);
  await sweepMissedTasks(db, String(wish.id), today, now);
  const current = await findTask(db, String(task.id));
  if (!current) throw notFound('task_not_found', '找不到这条任务。');

  const status = String(current.status ?? '');
  if (status === 'made_up') {
    throw badRequest('already_made_up', '这条任务已经补过卡了。', { task_date: current.task_date });
  }
  if (status !== 'missed') {
    throw badRequest('task_not_missed', '只有已错过的任务才能补卡。', { status });
  }

  const taskWeek = String(current.week_start ?? '') || weekStartOf(String(current.task_date ?? ''));
  const currentWeek = weekStartOf(today);
  if (taskWeek !== currentWeek) {
    throw badRequest('makeup_window_closed', '补卡券只覆盖本周的漏卡，这张券已经过期。', {
      task_week_start: taskWeek,
      current_week_start: currentWeek,
    });
  }

  const amountCents = String(current.side ?? '') === 'money' && input.amountCents !== undefined
    ? normalizeAmountCents(input.amountCents)
    : undefined;
  if (amountCents === null) {
    throw badRequest('invalid_amount', '请填写这次实际省下或挣到的金额（整数元）。');
  }
  const proof = await requireProofFile(db, principal.userId, String(wish.id), input.proofId);
  await issueMakeupTicket(db, wish, currentWeek, now);
  const ticket = await readMakeupTicket(db, String(wish.id), currentWeek, now);
  if (!ticket) {
    throw badRequest('makeup_ticket_unavailable', '本周没有可用的补卡券。', { week_start: currentWeek });
  }
  const ticketStatus = String(ticket.status ?? '');
  if (ticketStatus === 'expired') {
    throw badRequest('makeup_ticket_expired', '本周的补卡券已经过期了。', { week_start: currentWeek });
  }
  if (ticketStatus !== 'available') {
    throw badRequest('makeup_ticket_unavailable', '本周的补卡券已经用过了。', { week_start: currentWeek });
  }

  const timestamp = now.toISOString();
  const ticketUsePatch = { status: 'used', task_id: String(current.id), used_at: timestamp, updated_at: timestamp };
  const consumed = await affected(
    db.from('makeup_tickets').update(ticketUsePatch).eq('id', String(ticket.id)).eq('status', 'available'),
    'consume makeup ticket',
  );
  if (consumed !== 1) {
    throw badRequest('makeup_ticket_unavailable', '本周的补卡券刚刚被用掉了。', { week_start: currentWeek });
  }

  const taskMadeUpPatch = { status: 'made_up', made_up_at: timestamp, updated_at: timestamp };
  const madeUp = await affected(
    db.from('tasks').update(taskMadeUpPatch).eq('id', String(current.id)).eq('status', 'missed'),
    'mark task made up',
  );
  if (madeUp !== 1) {
    // 补偿：任务没改成，券不能白烧（仅当券仍指向本任务时放回）
    const ticketReleasePatch = { status: 'available', task_id: null, used_at: null, updated_at: timestamp };
    await affected(
      db.from('makeup_tickets').update(ticketReleasePatch)
        .eq('id', String(ticket.id)).eq('status', 'used').eq('task_id', String(current.id)),
      'release makeup ticket',
    );
    throw conflict('task_state_conflict', '任务状态刚被改过，请刷新后重试。');
  }

  const checkin = await storeCheckin(
    db,
    current,
    wish,
    proof,
    { ...input, amountCents: amountCents ?? undefined },
    true,
    today,
    now,
  );
  if (amountCents !== undefined && amountCents !== null) {
    await recordCheckinAmount(db, wish, current, checkin, amountCents, now);
  }
  await bumpWishVersion(db, String(wish.id), now);

  const freshTask = await findTask(db, String(current.id));
  const freshTicket = await readMakeupTicket(db, String(wish.id), currentWeek, now);
  if (!freshTask || !freshTicket) throw conflict('task_state_conflict', '补卡结果读取失败，请刷新后重试。');
  return { task: freshTask, checkin, ticket: freshTicket };
}

/** 发券：愿签 × 自然周唯一；周序号从签约周算起（首周 = 1），过期券直接落 expired */
export async function issueMakeupTicket(db: DbClient, wish: WishRow, weekStart: string, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  const expiresAt = makeupExpiresAt(weekStart);
  const startDate = String(wish.start_date ?? '');
  // 首周 = 1：签约周可能从周三开始，所以基准是「签约所在自然周的周一」而不是签约日
  const weekIndex = startDate === ''
    ? 1
    : Math.max(1, Math.floor(dayIndexOf(weekStartOf(startDate), weekStart) / 7) + 1);
  const ticketInsert = {
    id: uuid(),
    wish_id: String(wish.id),
    user_id: String(wish.user_id ?? ''),
    week_start: weekStart,
    week_index: weekIndex,
    status: Date.parse(expiresAt) <= now.getTime() ? 'expired' : 'available',
    task_id: null,
    used_at: null,
    expires_at: expiresAt,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await write(
    db.from('makeup_tickets').insertIfAbsent(ticketInsert, { onConflict: 'wish_id,week_start' }).select('id'),
    'issue makeup ticket',
  );
}

/** 读券并按 expires_at 惰性过期（无定时任务） */
export async function readMakeupTicket(
  db: DbClient,
  wishId: string,
  weekStart: string,
  now: Date,
): Promise<MakeupTicketRow | null> {
  const found = await firstAs<MakeupTicketRow>(
    db.from('makeup_tickets').select('*').eq('wish_id', wishId).eq('week_start', weekStart),
    'read makeup ticket',
  );
  if (!found) return null;
  if (String(found.status ?? '') !== 'available') return found;
  if (Date.parse(String(found.expires_at ?? '')) > now.getTime()) return found;
  const timestamp = now.toISOString();
  const ticketExpirePatch = { status: 'expired', updated_at: timestamp };
  await affected(
    db.from('makeup_tickets').update(ticketExpirePatch).eq('id', String(found.id)).eq('status', 'available'),
    'expire makeup ticket',
  );
  return { ...found, status: 'expired' } as MakeupTicketRow;
}

/** 今日页顺带展示本周券；契约期外返回 null（签约时首周券已由 signContract 发放） */
export async function ensureCurrentWeekTicket(
  db: DbClient,
  wish: WishRow,
  today: string,
  now: Date,
): Promise<MakeupTicketRow | null> {
  const startDate = String(wish.start_date ?? '');
  const endDate = String(wish.end_date ?? '');
  if (startDate === '' || today < startDate || today > endDate) return null;
  const weekStart = weekStartOf(today);
  await issueMakeupTicket(db, wish, weekStart, now);
  return readMakeupTicket(db, String(wish.id), weekStart, now);
}

/** 接口词表（proof_id）与库内列（proof_file_id）的唯一投影点 */
export function toCheckinDto(checkin: CheckinRow): Record<string, unknown> {
  return {
    id: checkin.id,
    task_id: checkin.task_id,
    proof_id: checkin.proof_file_id ?? null,
    note: String(checkin.note ?? ''),
    amount_cents: checkin.amount_cents === null || checkin.amount_cents === undefined ? null : Number(checkin.amount_cents),
    amount_kind: String(checkin.amount_kind ?? ''),
    is_makeup: checkin.is_makeup === true,
    channel: String(checkin.channel ?? 'online'),
    checkin_date: checkin.checkin_date,
    server_ts: checkin.server_ts,
    client_ts: checkin.client_ts ?? null,
    created_at: checkin.created_at,
    updated_at: checkin.updated_at,
  };
}

export function toMakeupTicketDto(ticket: MakeupTicketRow): Record<string, unknown> {
  return {
    id: ticket.id,
    week_start: ticket.week_start,
    week_index: Number(ticket.week_index ?? 1),
    status: ticket.status,
    expires_at: ticket.expires_at,
    task_id: ticket.task_id ?? null,
    used_at: ticket.used_at ?? null,
  };
}

