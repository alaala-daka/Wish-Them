/**
 * 账本（第 5 轮）：周预算 + 收支流水 + 实时聚合。
 *
 * 一致性（平台无事务）：
 * - 预算只落在 ledger_weeks.budget_cents；修改用单行 CAS（updated_at 作版本令牌），命中 0 行重读重试；
 * - 流水只追加 ledger_entries，不回写周汇总；spent/income/balance/counted 全部读时重算；
 * - 首周预算行在签约时 insertIfAbsent，之后按需补行，表级 UNIQUE(wish_id, week_start) 兜底。
 *
 * 口径（docs/01 §6.2、docs/02 §8）：
 * - 周结余 = max(0, 周预算 − 周非必要支出)，超预算不拦提交，只把结余记 0；
 * - 周计入 = 该周至少一条任务 done/made_up；
 * - 累计兑现 = Σ 已计入周结余 + Σ 已确认兼职收入；
 * - 结算前接口只返回金额与进度，绝不返回礼物名称、价格或匹配结果。
 */

import { affected, first, firstAs, rowsAs, write } from '../lib/db.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { uuid } from '../lib/id.ts';
import { addDays, dayIndexOf, isValidYmd, productDate, weekStartOf } from '../lib/time.ts';
import { bumpWishVersion, requireProofFile } from './checkin.ts';
import { findTask, listTasks } from './task.ts';
import type { WishRow } from './wish.ts';
import type { DbClient, DbRow, Principal } from '../lib/types.ts';

export type LedgerEntryRow = DbRow & { id: string };
export type LedgerWeekRow = DbRow & { id: string };

/** 五问推算不出金额时的兜底：¥50/周 */
export const DEFAULT_WEEKLY_BUDGET_CENTS = 5_000;
/** 可由五问档位推算出的预算区间（不是用户手填上限） */
export const MIN_DERIVED_BUDGET_CENTS = 2_000;
export const MAX_DERIVED_BUDGET_CENTS = 20_000;
/** 用户手填预算上限：¥2000/周，防整数溢出与误输入 */
export const MAX_WEEKLY_BUDGET_INPUT_CENTS = 200_000;
export const MAX_EXPENSE_CENTS = 200_000;
export const MIN_EARNING_CENTS = 1;
export const MAX_EARNING_CENTS = 100_000;

/** 契约最长 30 天，跨周最多 6 周；留一倍余量 */
const WEEKS_LIMIT = 10;
const WEEK_ROW_LIMIT = 20;
const ENTRIES_LIMIT = 1_000;

const BAND_BUDGET_CENTS: Record<string, number> = {
  under_100: 2_000,
  '100_299': 4_000,
  '300_599': 8_000,
  '600_999': 12_000,
  '1000_plus': 20_000,
};

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1_000,
  万: 10_000,
};

/** manual 只开放 expense / earning；saved 由金钱任务打卡内部写入 */
export type EntryType = 'expense' | 'earning' | 'saved';

const TYPE_TO_DB: Record<EntryType, string> = { expense: 'expense', earning: 'earned', saved: 'saved' };
const DB_TO_TYPE: Record<string, EntryType> = { expense: 'expense', earned: 'earning', saved: 'saved' };

/** 五问档位 → 首周默认预算；未知档位走兜底，保证确定性 */
export function weeklyBudgetFromBand(band: string): number {
  return BAND_BUDGET_CENTS[band] ?? DEFAULT_WEEKLY_BUDGET_CENTS;
}

/**
 * 把 q4 明文归一到粗粒度档位（确定性解析，不依赖模型）。
 * 支持阿拉伯数字（含 万/千/百/k）与常见中文数字；识别不出时按「说不清/很少」处理。
 */
export function disposableBandOf(answer: string): string {
  const text = answer.trim();
  if (text === '') return '';
  const amount = parseMonthlyDisposable(text);
  if (amount === null) {
    return /没|无|不到|零|紧|少|难|有限/.test(text) ? 'under_100' : '100_299';
  }
  const hedged = /没|无|不到|零|紧/.test(text) && amount <= 100;
  if (hedged || amount < 100) return 'under_100';
  if (amount < 300) return '100_299';
  if (amount < 600) return '300_599';
  if (amount < 1_000) return '600_999';
  return '1000_plus';
}

function parseMonthlyDisposable(text: string): number | null {
  const arabic = /(\d+(?:\.\d+)?)\s*(万|千|百|[kK])?/.exec(text);
  if (arabic) {
    const unit = arabic[2] === '万' ? 10_000
      : arabic[2] === '千' || arabic[2] === 'k' || arabic[2] === 'K' ? 1_000
        : arabic[2] === '百' ? 100
          : 1;
    return Math.round(Number(arabic[1]) * unit);
  }
  const chinese = /[零〇一二两三四五六七八九十百千万]+/.exec(text);
  if (!chinese) return null;
  let total = 0;
  let current = 0;
  let saw = false;
  for (const char of chinese[0]) {
    if (char in CN_DIGITS) {
      current = CN_DIGITS[char];
      saw = true;
      continue;
    }
    const unit = CN_UNITS[char];
    if (unit === 10_000) {
      total = (total + current) * unit;
      current = 0;
    } else {
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
    }
    saw = true;
  }
  return saw ? total + current : null;
}

/** 愿签上的默认周预算：签约时由 q4 档位写入；异常值回落到兜底 */
export function defaultWeeklyBudgetCents(wish: WishRow): number {
  if (wish.weekly_budget_cents === null || wish.weekly_budget_cents === undefined) {
    return DEFAULT_WEEKLY_BUDGET_CENTS;
  }
  const value = Number(wish.weekly_budget_cents);
  if (!Number.isSafeInteger(value) || value < MIN_DERIVED_BUDGET_CENTS || value > MAX_DERIVED_BUDGET_CENTS) {
    return DEFAULT_WEEKLY_BUDGET_CENTS;
  }
  return value;
}

/** 路径/入参的 week_start 必须是周一；返回原字符串便于直接比较 */
export function parseWeekStart(raw: string, field = 'week_start'): string {
  if (!isValidYmd(raw) || weekStartOf(raw) !== raw) {
    throw badRequest('invalid_parameter', `${field} 必须是某个周一的 YYYY-MM-DD。`, {
      fields: { [field]: 'must be a Monday' },
    });
  }
  return raw;
}

interface ContractWeeks {
  startWeek: string;
  endWeek: string;
  currentWeek: string;
  weeks: string[];
}

/** 只对 active 且有起止日的愿签开放账本；否则 400（与任务页口径一致） */
function requireContract(wish: WishRow, now: Date): ContractWeeks {
  const status = String(wish.status ?? '');
  const startDate = String(wish.start_date ?? '');
  const endDate = String(wish.end_date ?? '');
  if (status !== 'active' || startDate === '' || endDate === '') {
    throw badRequest('wish_not_active', '愿签还没立契或已结束，暂时没有账本。', { status });
  }
  const startWeek = weekStartOf(startDate);
  const endWeek = weekStartOf(endDate);
  const currentWeek = weekStartOf(productDate(now));
  const weeks: string[] = [];
  for (let index = 0; index < WEEKS_LIMIT; index += 1) {
    const week = addDays(startWeek, index * 7);
    if (week > endWeek) break;
    weeks.push(week);
  }
  if (weeks.length === 0) {
    throw badRequest('wish_not_active', '愿签契约日期异常，暂时没有账本。', { status });
  }
  return { startWeek, endWeek, currentWeek, weeks };
}

function requireWeekInContract(contract: ContractWeeks, weekStart: string): void {
  if (weekStart < contract.startWeek || weekStart > contract.endWeek) {
    throw badRequest('week_not_in_contract', '这一周不在愿签契约期内。', {
      week_start: weekStart,
      start_week: contract.startWeek,
      end_week: contract.endWeek,
    });
  }
}

function weekIndexOf(contract: ContractWeeks, weekStart: string): number {
  return Math.max(1, Math.floor(dayIndexOf(contract.startWeek, weekStart) / 7) + 1);
}

/** 首周行在签约时创建；之后访问/记账时按需补行（同一周只会有一行） */
export async function ensureWeekBudgetRow(
  db: DbClient,
  wish: WishRow,
  weekStart: string,
  now: Date,
): Promise<LedgerWeekRow> {
  const wishId = String(wish.id);
  const existing = await firstAs<LedgerWeekRow>(
    db.from('ledger_weeks').select('*').eq('wish_id', wishId).eq('week_start', weekStart),
    'read ledger week',
  );
  if (existing) return existing;

  const contract = requireContract(wish, now);
  requireWeekInContract(contract, weekStart);
  const timestamp = now.toISOString();
  const weekInsert = {
    id: uuid(),
    wish_id: wishId,
    user_id: String(wish.user_id ?? ''),
    week_start: weekStart,
    week_index: weekIndexOf(contract, weekStart),
    budget_cents: defaultWeeklyBudgetCents(wish),
    spent_cents: 0,
    saved_cents: 0,
    earned_cents: 0,
    counted: false,
    over_budget: false,
    proof_file_id: null,
    computed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await write(
    db.from('ledger_weeks').insertIfAbsent(weekInsert, { onConflict: 'wish_id,week_start' }).select('id'),
    'insert ledger week',
  );
  const row = await firstAs<LedgerWeekRow>(
    db.from('ledger_weeks').select('*').eq('wish_id', wishId).eq('week_start', weekStart),
    'reread ledger week',
  );
  if (!row) throw conflict('ledger_week_conflict', '本周账本刚被初始化，请刷新后重试。');
  return row;
}

interface EntryTotals {
  expense: number;
  earning: number;
  saved: number;
}

function centsOf(row: DbRow | undefined, column: string): number {
  const value = Number(row?.[column] ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function yuan(cents: number): number {
  return Math.floor(cents / 100);
}

/** 账单只认未撤销流水；第 5 轮不提供撤销入口，但读取口径先按可撤销设计 */
async function listEntries(db: DbClient, wishId: string): Promise<LedgerEntryRow[]> {
  return rowsAs<LedgerEntryRow>(
    db.from('ledger_entries')
      .select('id,wish_id,week_start,entry_kind,amount_cents,task_id,proof_file_id,revoked_at,server_ts')
      .eq('wish_id', wishId)
      .isNull('revoked_at')
      .limit(ENTRIES_LIMIT),
    'read ledger entries',
  );
}

function entryTotalsByWeek(entries: LedgerEntryRow[], weeks: string[]): Map<string, EntryTotals> {
  const totals = new Map<string, EntryTotals>();
  for (const week of weeks) totals.set(week, { expense: 0, earning: 0, saved: 0 });
  for (const entry of entries) {
    const week = String(entry.week_start ?? '');
    const bucket = totals.get(week);
    if (!bucket) continue;
    const kind = String(entry.entry_kind ?? '');
    const amount = centsOf(entry, 'amount_cents');
    if (kind === 'expense') bucket.expense += amount;
    else if (kind === 'earned') bucket.earning += amount;
    else if (kind === 'saved') bucket.saved += amount;
  }
  return totals;
}

/** 周是否计入：该周至少一条任务 done/made_up；任务行缺 week_start 时按 task_date 兜底 */
function countedWeeksOf(tasks: Awaited<ReturnType<typeof listTasks>>): Set<string> {
  const counted = new Set<string>();
  for (const task of tasks) {
    const status = String(task.status ?? '');
    if (status !== 'done' && status !== 'made_up') continue;
    const week = String(task.week_start ?? '') || weekStartOf(String(task.task_date ?? ''));
    if (week !== '') counted.add(week);
  }
  return counted;
}

export interface LedgerWeekView {
  week_start: string;
  week_index: number;
  is_current: boolean;
  is_future: boolean;
  counted: boolean;
  budget_cents: number;
  budget_yuan: number;
  spent_cents: number;
  spent_yuan: number;
  income_cents: number;
  income_yuan: number;
  /** 金钱任务打卡时用户自填的“省下”金额 */
  task_saved_cents: number;
  task_saved_yuan: number;
  balance_cents: number;
  balance_yuan: number;
  over_budget: boolean;
  progress_bps: number;
  notice: string;
}

export interface LedgerTotalsView {
  contract_weeks: number;
  counted_weeks: number;
  budget_cents: number;
  spent_cents: number;
  /** 任务省下（有金钱任务流水时以它为准） */
  saved_cents: number;
  /** 周预算结余（参考值；没有任务省下流水时作为旧愿签的兼容口径） */
  budget_balance_cents: number;
  /** 任务省下流水总额 */
  task_saved_cents: number;
  income_cents: number;
  realized_cents: number;
  current_week_start: string;
}

export interface LedgerProgressView {
  over_budget: boolean;
  budget_used_bps: number;
  counted_weeks: number;
  contract_weeks: number;
  message: string;
}

export interface LedgerView {
  wish_id: string;
  week: LedgerWeekView;
  weeks: LedgerWeekView[];
  /** 契约期内的流水，按创建时间升序；只追加，不提供修改/删除 */
  entries: Record<string, unknown>[];
  totals: LedgerTotalsView;
  progress: LedgerProgressView;
}

/**
 * 账本总览：默认当前周，也可指定契约内任意一周（含未来周，方便提前设预算）。
 * 所有金额读时重算，不读 ledger_weeks 的派生列，避免与流水脱节。
 */
export async function readLedger(
  db: DbClient,
  wish: WishRow,
  selectedWeek: string | null,
  now: Date,
): Promise<LedgerView> {
  const contract = requireContract(wish, now);
  if (selectedWeek !== null) requireWeekInContract(contract, selectedWeek);
  const effectiveCurrent = clampWeek(contract.currentWeek, contract.startWeek, contract.endWeek);
  const targetWeek = selectedWeek ?? effectiveCurrent;

  const [weekRows, entries, tasks] = await Promise.all([
    rowsAs<LedgerWeekRow>(
      db.from('ledger_weeks').select('*').eq('wish_id', String(wish.id)).in('week_start', contract.weeks).limit(WEEK_ROW_LIMIT),
      'read ledger weeks',
    ),
    listEntries(db, String(wish.id)),
    listTasks(db, String(wish.id)),
  ]);
  const rowByWeek = new Map(weekRows.map((row) => [String(row.week_start), row]));
  const moneyByWeek = entryTotalsByWeek(entries, contract.weeks);
  const counted = countedWeeksOf(tasks);

  const weeks: LedgerWeekView[] = contract.weeks.map((weekStart) => {
    const row = rowByWeek.get(weekStart);
    const money = moneyByWeek.get(weekStart) ?? { expense: 0, earning: 0 };
    const budget = row ? centsOf(row, 'budget_cents') : defaultWeeklyBudgetCents(wish);
    return toLedgerWeekDto({
      weekStart,
      weekIndex: weekIndexOf(contract, weekStart),
      currentWeek: effectiveCurrent,
      budget,
      spent: money.expense,
      income: money.earning,
      taskSaved: money.saved,
      counted: counted.has(weekStart),
    });
  });

  const selected = weeks.find((week) => week.week_start === targetWeek) ?? weeks[0];
  const budgetBalanceCents = weeks.filter((week) => week.counted).reduce((sum, week) => sum + week.balance_cents, 0);
  const taskSavedCents = weeks.reduce((sum, week) => sum + week.task_saved_cents, 0);
  // 有任务省下流水时以用户自填金额为准；旧愿签没有这条流水时回退到周预算结余
  const savedCents = taskSavedCents > 0 ? taskSavedCents : budgetBalanceCents;
  const incomeCents = weeks.reduce((sum, week) => sum + week.income_cents, 0);
  const spentCents = weeks.reduce((sum, week) => sum + week.spent_cents, 0);
  const budgetCents = weeks.reduce((sum, week) => sum + week.budget_cents, 0);
  const countedWeeks = weeks.filter((week) => week.counted).length;
  const totals: LedgerTotalsView = {
    contract_weeks: contract.weeks.length,
    counted_weeks: countedWeeks,
    budget_cents: budgetCents,
    spent_cents: spentCents,
    saved_cents: savedCents,
    budget_balance_cents: budgetBalanceCents,
    task_saved_cents: taskSavedCents,
    income_cents: incomeCents,
    realized_cents: savedCents + incomeCents,
    current_week_start: effectiveCurrent,
  };
  const progress: LedgerProgressView = {
    over_budget: selected.over_budget,
    budget_used_bps: selected.progress_bps,
    counted_weeks: countedWeeks,
    contract_weeks: contract.weeks.length,
    message: progressMessage(selected),
  };
  const contractWeeks = new Set(contract.weeks);
  const visibleEntries = entries
    .filter((entry) => contractWeeks.has(String(entry.week_start)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(toLedgerEntryDto);
  return {
    wish_id: String(wish.id),
    week: selected,
    weeks,
    entries: visibleEntries,
    totals,
    progress,
  };
}

function clampWeek(week: string, start: string, end: string): string {
  if (week < start) return start;
  if (week > end) return end;
  return week;
}

interface WeekInput {
  weekStart: string;
  weekIndex: number;
  currentWeek: string;
  budget: number;
  spent: number;
  income: number;
  taskSaved: number;
  counted: boolean;
}

function toLedgerWeekDto(input: WeekInput): LedgerWeekView {
  const balance = Math.max(0, input.budget - input.spent);
  const overBudget = input.spent > input.budget;
  const progressBps = input.budget > 0
    ? Math.min(10_000, Math.floor((input.spent * 10_000) / input.budget))
    : input.spent > 0 ? 10_000 : 0;
  return {
    week_start: input.weekStart,
    week_index: input.weekIndex,
    is_current: input.weekStart === input.currentWeek,
    is_future: input.weekStart > input.currentWeek,
    counted: input.counted,
    budget_cents: input.budget,
    budget_yuan: yuan(input.budget),
    spent_cents: input.spent,
    spent_yuan: yuan(input.spent),
    income_cents: input.income,
    income_yuan: yuan(input.income),
    task_saved_cents: input.taskSaved,
    task_saved_yuan: yuan(input.taskSaved),
    balance_cents: balance,
    balance_yuan: yuan(balance),
    over_budget: overBudget,
    progress_bps: progressBps,
    notice: overBudget ? '本周已超预算，结余按 0 计，不再扣成负数。' : '',
  };
}

function progressMessage(week: LedgerWeekView): string {
  if (week.over_budget) return '本周已超预算，结余按 0 计。';
  if (week.budget_cents === 0) return '本周还没设预算。';
  if (week.progress_bps >= 10_000) return '本周预算刚好用完。';
  return `本周预算已用 ${Math.floor(week.progress_bps / 100)}%。`;
}

function nextTimestamp(now: Date, previous: string): string {
  const previousMs = Date.parse(previous);
  const base = Number.isNaN(previousMs) ? now.getTime() : previousMs + 1;
  return new Date(Math.max(now.getTime(), base)).toISOString();
}

export interface BudgetOutcome {
  week: LedgerWeekView;
  totals: LedgerTotalsView;
  progress: LedgerProgressView;
}

/**
 * 设置/修改周预算：仅当前及未来周；历史周只读。
 * 并发用 updated_at 单行 CAS；同一预算的并发重放视为成功，其余冲突 409。
 */
export async function setWeekBudget(
  db: DbClient,
  wish: WishRow,
  weekStart: string,
  budgetCents: number,
  now: Date,
): Promise<BudgetOutcome> {
  const contract = requireContract(wish, now);
  requireWeekInContract(contract, weekStart);
  if (weekStart < contract.currentWeek) {
    throw badRequest('week_not_editable', '历史周的预算已锁定，不能再修改。', {
      week_start: weekStart,
      current_week_start: contract.currentWeek,
    });
  }
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0 || budgetCents > MAX_WEEKLY_BUDGET_INPUT_CENTS) {
    throw badRequest('invalid_parameter', `预算必须是 0~${MAX_WEEKLY_BUDGET_INPUT_CENTS} 的整数分。`, {
      fields: { budget_cents: `0..${MAX_WEEKLY_BUDGET_INPUT_CENTS}` },
    });
  }

  let row = await ensureWeekBudgetRow(db, wish, weekStart, now);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previousUpdatedAt = String(row.updated_at ?? '');
    const hit = await affected(
      db.from('ledger_weeks')
        .update({ budget_cents: budgetCents, updated_at: nextTimestamp(now, previousUpdatedAt) })
        .eq('id', String(row.id))
        .eq('updated_at', previousUpdatedAt),
      'update ledger week budget',
    );
    if (hit === 1) {
      await bumpWishVersion(db, String(wish.id), now);
      return readBudgetOutcome(db, wish, weekStart, now);
    }
    const fresh = await firstAs<LedgerWeekRow>(
      db.from('ledger_weeks').select('*').eq('id', String(row.id)),
      'reread ledger week after conflict',
    );
    if (!fresh) throw conflict('ledger_week_conflict', '本周账本刚被更新过，请刷新后重试。');
    if (centsOf(fresh, 'budget_cents') === budgetCents) {
      return readBudgetOutcome(db, wish, weekStart, now);
    }
    row = fresh;
  }
  throw conflict('ledger_week_conflict', '预算刚被其他操作改过，请刷新后重试。');
}

async function readBudgetOutcome(db: DbClient, wish: WishRow, weekStart: string, now: Date): Promise<BudgetOutcome> {
  const view = await readLedger(db, wish, weekStart, now);
  return { week: view.week, totals: view.totals, progress: view.progress };
}

export interface NewEntryInput {
  weekStart: string;
  type: EntryType;
  amountCents: number;
  note: string;
  proofId: string | null;
  taskId: string | null;
}

export interface EntryOutcome {
  entry: Record<string, unknown>;
  week: LedgerWeekView;
  totals: LedgerTotalsView;
  progress: LedgerProgressView;
  notice: string;
}

/**
 * 追加一条收支：
 * - 支出 0~200000 分，直接进入当周支出（超预算只影响结余）；
 * - 兼职收入 1~100000 分，必须关联本愿签内状态 done/made_up 的钱任务；
 *   proof_id 可选（本轮明确口径：两段式上传未落地，不阻塞记账），传入则必须是合法的 ledger_proof；
 * - 同一钱任务只能确认一次收入（先读校验；表级无唯一索引，并发窗口见 docs/07）。
 */
export async function addLedgerEntry(
  db: DbClient,
  principal: Principal,
  wish: WishRow,
  input: NewEntryInput,
  now: Date,
): Promise<EntryOutcome> {
  const contract = requireContract(wish, now);
  requireWeekInContract(contract, input.weekStart);
  if (input.weekStart > contract.currentWeek) {
    throw badRequest('week_not_started', '未来的周还不能记账。', {
      week_start: input.weekStart,
      current_week_start: contract.currentWeek,
    });
  }

  const amount = input.amountCents;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw badRequest('invalid_parameter', '金额必须是非负整数分。', { fields: { amount_cents: 'must be integer cents' } });
  }
  if (input.type === 'expense' && amount > MAX_EXPENSE_CENTS) {
    throw badRequest('invalid_parameter', `单笔支出不能超过 ${MAX_EXPENSE_CENTS} 分。`, {
      fields: { amount_cents: `max ${MAX_EXPENSE_CENTS}` },
    });
  }
  if (input.type === 'earning' && (amount < MIN_EARNING_CENTS || amount > MAX_EARNING_CENTS)) {
    throw badRequest('invalid_parameter', `兼职收入必须在 ${MIN_EARNING_CENTS}~${MAX_EARNING_CENTS} 分之间。`, {
      fields: { amount_cents: `${MIN_EARNING_CENTS}..${MAX_EARNING_CENTS}` },
    });
  }

  let proofId: string | null = null;
  if (input.proofId !== null) {
    const proof = await requireProofFile(db, principal.userId, String(wish.id), input.proofId, ['ledger_proof']);
    proofId = String(proof.id);
  }

  const wishId = String(wish.id);
  let taskId: string | null = null;
  if (input.type === 'earning') {
    taskId = await requireEarningTask(db, wishId, input.taskId, input.weekStart);
    // 当前是「先查后插」：同一 task_id 的并发双请求可能都通过检查。
    // ledger_entries 是追加表，平台本批次无法给 (wish_id, task_id, entry_kind) 加建表期 UNIQUE，
    // 所以并发边界由客户端 Idempotency-Key + 单任务收入上限提示共同兜底；
    // 根治需要后续迁移新增一张「收入占用」表或在建表期补 UNIQUE，再配合单行 CAS。
    const duplicated = await first(
      db.from('ledger_entries')
        .select('id')
        .eq('wish_id', wishId)
        .eq('task_id', taskId)
        .eq('entry_kind', 'earned')
        .isNull('revoked_at'),
      'read earning link',
    );
    if (duplicated) {
      throw badRequest('duplicate_earning_link', '这条钱任务已经登记过收入了。', { task_id: taskId });
    }
  } else if (input.taskId !== null) {
    throw badRequest('invalid_parameter', '支出记录不需要关联任务。', { fields: { task_id: 'not allowed for expense' } });
  }

  await ensureWeekBudgetRow(db, wish, input.weekStart, now);
  const timestamp = now.toISOString();
  const entryInsert = {
    id: uuid(),
    wish_id: wishId,
    user_id: principal.userId,
    week_start: input.weekStart,
    entry_kind: TYPE_TO_DB[input.type],
    amount_cents: amount,
    note: input.note,
    proof_file_id: proofId,
    task_id: taskId,
    checkin_id: null,
    source: 'manual',
    revoked_at: null,
    server_ts: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const inserted = await write(
    db.from('ledger_entries').insert(entryInsert).select('*'),
    'create ledger entry',
  );
  if (inserted.length !== 1) throw conflict('ledger_entry_failed', '记账失败，请稍后重试。');
  await bumpWishVersion(db, wishId, now);

  const view = await readLedger(db, wish, input.weekStart, now);
  return {
    entry: toLedgerEntryDto(inserted[0] as LedgerEntryRow),
    week: view.week,
    totals: view.totals,
    progress: view.progress,
    notice: view.week.over_budget
      ? '本周已超预算，结余按 0 计，不再扣成负数。'
      : input.type === 'expense' ? '支出已记入本周账本。' : '兼职收入已记入本周账本。',
  };
}

/** 兼职收入关联任务：必须存在、属于本愿签、是钱任务、已完成/已补卡，且落在同一自然周 */
async function requireEarningTask(
  db: DbClient,
  wishId: string,
  taskId: string | null,
  weekStart: string,
): Promise<string> {
  if (taskId === null) {
    throw badRequest('earning_task_required', '兼职收入必须关联一条已完成的钱任务。', {
      fields: { task_id: 'required for earning' },
    });
  }
  const task = await findTask(db, taskId);
  if (!task) throw notFound('task_not_found', '找不到关联的任务。');
  if (String(task.wish_id ?? '') !== wishId) {
    throw forbidden('task_forbidden', '关联任务不属于这个愿签。');
  }
  if (String(task.side ?? '') !== 'money') {
    throw badRequest('earning_task_required', '兼职收入只能关联钱任务。', { task_id: taskId, side: task.side });
  }
  const status = String(task.status ?? '');
  if (status !== 'done' && status !== 'made_up') {
    throw badRequest('earning_task_not_done', '关联的钱任务还没完成，完成后才能登记收入。', {
      task_id: taskId,
      status,
    });
  }
  const taskWeek = String(task.week_start ?? '') || weekStartOf(String(task.task_date ?? ''));
  if (taskWeek !== weekStart) {
    throw badRequest('earning_week_mismatch', '收入必须记在关联任务所在的自然周。', {
      task_week_start: taskWeek,
      week_start: weekStart,
    });
  }
  return taskId;
}

export function toLedgerEntryDto(entry: LedgerEntryRow): Record<string, unknown> {
  const kind = String(entry.entry_kind ?? '');
  return {
    id: entry.id,
    wish_id: entry.wish_id,
    week_start: entry.week_start,
    type: DB_TO_TYPE[kind] ?? kind,
    amount_cents: centsOf(entry, 'amount_cents'),
    amount_yuan: yuan(centsOf(entry, 'amount_cents')),
    note: String(entry.note ?? ''),
    proof_id: entry.proof_file_id ?? null,
    task_id: entry.task_id ?? null,
    server_ts: entry.server_ts,
    created_at: entry.created_at,
  };
}