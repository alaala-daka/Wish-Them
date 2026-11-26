/**
 * 演示模式（第 8 轮）：身份仓储 + 预置场景编排。
 *
 * 隔离方式（物理隔离，不靠前端标记）：
 * - 演示数据全部挂在 users.is_demo = true 的账号 + demo_sessions 行上；
 * - 真实接口按 principal.userId / isDemo 过滤，天然读不到演示数据；
 * - 演示 session 无法发布公开池、无法生成分享链、无法调用真实 AI（路由层 requireRealUser）。
 *
 * 逻辑复用：
 * - 愿签创建、五问、契约签署、任务生成（planTasks + insertPlannedTasks）、打卡、账本记账、
 *   结局判定、礼物匹配全部调用真实 domain 引擎；
 * - 唯一属于演示编排的是：把契约时钟整体前移（预置「第 3 天」）、重建时清理演示子表、
 *   以及按场景补齐/跳过任务状态——这些都不改变引擎规则。
 *
 * 一致性（平台无事务）：
 * - 会话状态变更用 demo_sessions.updated_at 单行 CAS，抢不到就 409，串行化重建；
 * - 过期会话惰性清理（创建新会话时顺手删），不依赖定时任务与触发器；
 * - 演示重建是「先删子表再重放真实引擎」，任务 id 由 (愿签,天,序) 派生，重放结果稳定。
 */

import { affected, first, firstAs, mutate, rowsAs, write } from '../lib/db.ts';
import { badRequest, conflict, internal, notFound, unauthorized } from '../lib/errors.ts';
import { sha256Hex, utf8 } from '../lib/crypto.ts';
import { uuid } from '../lib/id.ts';
import { enforceWindow, hourlyWindow } from '../lib/quota.ts';
import { dayIndexOf, productDate, settleOpenAt, weekStartOf } from '../lib/time.ts';
import { createUser, findUser, issueSession, toUserDto, type UserRow } from './users.ts';
import {
  createWish,
  findWish,
  saveAnswers,
  signContract,
  toWishDto,
  type WishRow,
} from './wish.ts';
import { checkinTask, type FileRow } from './checkin.ts';
import { addLedgerEntry, ensureWeekBudgetRow, readLedger, type LedgerView } from './ledger.ts';
import { listTasks, listTasksByDate, sweepMissedTasks, toTaskDto, type TaskRow } from './task.ts';
import { readSettlement, settleWish, type SettlementView } from './settlement.ts';
import type { AppConfig, DbClient, DbRow, Principal } from '../lib/types.ts';

const DAY_MS = 86_400_000;
/** 预置人设：契约开始于两天前，今天正好是第 3 天 */
const BASELINE_OFFSET_DAYS = 2;
/** 快进/切结局：7 天契约整体落在过去，截止日次日 04:00 已过，可直接结算 */
const FULL_OFFSET_DAYS = 8;
const DEMO_DAYS = 7;
const DEMO_EXPENSE_CENTS = 3_200;
const DEMO_EARNING_FALLBACK_CENTS = 2_000;
const PURGE_LIMIT = 3;

export const DEMO_SCENARIOS = ['double_realized', 'cyber_only', 'failed'] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

const PERSONA_WISH_TEXT = '妈妈的膝盖疼了好久，总说忍一忍就过去了；我想让她别再一个人硬扛，能好好去做一次检查。';

const PERSONA_INPUT = {
  relation: '妈妈',
  nickname: '妈妈',
  pronoun: 'she',
  wishText: PERSONA_WISH_TEXT,
};

/** 五问只用于真实引擎（分类、预算档位、礼物类别），明文只存在密文列里 */
const PERSONA_ANSWERS: Record<string, string> = {
  q1: '她膝盖疼了半年，总说忍一忍就过去了。',
  q2: '她一个人在家，疼起来也没人能搭把手。',
  q3: '寒假回家，能待两周左右。',
  q4: '每个月能省下 1000 元',
  q5: '想给她买一副护膝，再陪她去做一次检查。',
};

const PERSONA_VIEW = {
  label: '异地大三学生 · 替妈妈许愿',
  relation: PERSONA_INPUT.relation,
  pronoun: PERSONA_INPUT.pronoun,
  wish_text: PERSONA_WISH_TEXT,
  preset: '第 3 天进度 · 2 条打卡记录 · 账本累计 168 元',
};

const CHILD_TABLES = ['settlements', 'checkins', 'ledger_entries', 'ledger_weeks', 'makeup_tickets', 'tasks'] as const;

export type DemoSessionRow = DbRow & { id: string };

export interface DemoContext {
  user: UserRow;
  demoSessionId: string;
  isNew: boolean;
}

/** 同一 demo_session_id 反复进入仍拿到同一个账号；TTL 走环境变量 DEMO_TTL_HOURS */
export async function resolveDemoUser(
  db: DbClient,
  config: AppConfig,
  demoSessionId: string,
  ipHash: string | null,
  client: string,
  now: Date,
): Promise<DemoContext> {
  const existing = await first(
    db.from('demo_sessions').select('*').eq('id', demoSessionId),
    'read demo session',
  );
  const boundUserId = existing ? String(existing.user_id ?? '') : '';
  if (existing && boundUserId && !isExpired(existing, now)) {
    const user = await findUser(db, boundUserId);
    if (user && user.is_demo === true) {
      await write(
        db.from('demo_sessions').update({ last_seen_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('id', demoSessionId).select('id'),
        'touch demo session',
      );
      return { user: user as UserRow, demoSessionId, isNew: false };
    }
    // 演示账号被清理而会话还在：重新生成一个，会话继续复用同一个 id
  }

  const created = await createUser(db, config, {
    client,
    regChannel: 'demo',
    regIpHash: ipHash,
    isDemo: true,
    nickname: '体验官',
    avatar: 'default_07',
  }, now);
  const ttlMs = config.demoTtlHours * 3_600_000;
  const values = {
    id: demoSessionId,
    user_id: created.user.id,
    ip_hash: ipHash ?? '',
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    last_seen_at: now.toISOString(),
    created_at: existing ? String(existing.created_at ?? now.toISOString()) : now.toISOString(),
    updated_at: now.toISOString(),
  };
  if (existing) {
    await write(db.from('demo_sessions').update(values).eq('id', demoSessionId).select('id'), 'refresh demo session');
  } else {
    await write(db.from('demo_sessions').insertIfAbsent(values, { onConflict: 'id' }).select('id'), 'create demo session');
  }
  // 演示会话与演示账号必须同源，缺任一条即回滚式报错，避免"下次进来换人"
  const check = await first(db.from('demo_sessions').select('user_id').eq('id', demoSessionId), 'verify demo session');
  if (!check || String(check.user_id ?? '') !== created.user.id) {
    throw conflict('demo_session_unavailable', '演示环境繁忙，请稍后重试。');
  }
  return { user: created.user, demoSessionId, isNew: true };
}

function isExpired(row: DbRow, now: Date): boolean {
  const expiresAt = String(row.expires_at ?? '');
  return expiresAt === '' || expiresAt <= now.toISOString();
}

/* ── 会话创建 / 读取 ─────────────────────────────────────────────── */

export interface DemoSessionGrant {
  session: {
    demo_session_id: string;
    access_token: string;
    token_type: 'Bearer';
    expires_at: string;
    expires_in_seconds: number;
  };
  user: Record<string, unknown>;
  persona: typeof PERSONA_VIEW;
  state: DemoStateView;
}

/**
 * 新建演示会话：先清理本 IP 最早的过期会话 → 单 IP 小时窗限流 → 演示账号
 * → 真实引擎铺预置数据 → 演示 token。
 * 每次调用都生成新的会话 id，不复用客户端传入的 id（避免猜到别人的演示账号）。
 */
export async function createDemoSession(
  db: DbClient,
  config: AppConfig,
  ipHash: string | null,
  client: string,
  now: Date,
): Promise<DemoSessionGrant> {
  // 先清理再计数：否则过期会话会继续占用 DEMO_PER_HOUR 的小时窗名额
  await purgeExpiredDemoSessions(db, now, ipHash);

  if (ipHash) {
    const window = hourlyWindow(now, 1);
    await enforceWindow(db, 'demo_sessions', {
      column: 'ip_hash',
      value: ipHash,
      since: window.since,
      limit: config.demoPerHour,
      errorCode: 'demo_too_many_sessions',
      message: '演示次数太多啦，明天再来。',
      resetAt: window.resetAt,
      now,
    });
  }

  const demoSessionId = uuid();
  const demo = await resolveDemoUser(db, config, demoSessionId, ipHash, client, now);
  const principal = demoPrincipal(demo.user.id, client);
  const prepared = await prepareDemoContract(db, config, principal, now, BASELINE_OFFSET_DAYS);
  await completeBaseline(db, config, principal, prepared, now);

  const ttlSeconds = config.demoTtlHours * 3_600;
  const session = await issueSession(db, config, demo.user, { client, isDemo: true, ttlSeconds }, now);
  const row = await requireSessionRowById(db, demoSessionId);
  await finishDemoSession(db, row, String(row.updated_at ?? ''), {
    mode: 'baseline',
    scenario: 'mom_knee',
    step: 3,
    is_completed: false,
  }, now);

  return {
    session: {
      demo_session_id: demoSessionId,
      access_token: session.accessToken,
      token_type: 'Bearer',
      expires_at: session.expiresAt,
      expires_in_seconds: ttlSeconds,
    },
    user: toUserDto(demo.user),
    persona: PERSONA_VIEW,
    state: await readDemoState(db, config, principal, now),
  };
}

export interface DemoStateView {
  demo: Record<string, unknown>;
  persona: typeof PERSONA_VIEW;
  wish: Record<string, unknown>;
  progress: Record<string, unknown>;
  today_tasks: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  ledger: LedgerView | null;
  settlement: SettlementView | null;
  settle_open_at: string;
}

/** 演示状态：愿签详情 + 今日任务 + 账本 + 结算状态；只凭演示 token，无需真实登录 */
export async function readDemoState(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  now: Date,
): Promise<DemoStateView> {
  const session = await requireDemoSession(db, principal, now);
  const wish = await requireDemoWish(db, principal.userId);
  const today = productDate(now);
  if (String(wish.status ?? '') === 'active') {
    await sweepMissedTasks(db, String(wish.id), today, now);
  }
  const fresh = (await findWish(db, String(wish.id))) ?? wish;
  const tasks = await listTasks(db, String(wish.id));
  const startDate = String(fresh.start_date ?? '');
  const endDate = String(fresh.end_date ?? '');
  const status = String(fresh.status ?? '');

  const todayTasks = status === 'active' ? await listTasksByDate(db, String(fresh.id), today) : [];
  let ledger: LedgerView | null = null;
  if (startDate !== '' && endDate !== '' && (status === 'active' || status === 'settled')) {
    // 结算后账本不再对真实接口开放；演示状态需要展示最终账本，这里以只读副本绕过状态门禁
    const ledgerWish = status === 'active' ? fresh : ({ ...fresh, status: 'active' } as WishRow);
    ledger = await readLedger(db, ledgerWish, null, now);
  }
  const settlement = status === 'settled' ? await readSettlement(db, fresh) : null;
  const state = stateObject(session);
  const total = tasks.length;
  const done = tasks.filter((task) => isDone(String(task.status ?? ''))).length;
  const mustTotal = tasks.filter((task) => task.is_must === true).length;
  const mustDone = tasks.filter((task) => task.is_must === true && isDone(String(task.status ?? ''))).length;

  return {
    demo: {
      session_id: session.id,
      scenario: String(session.scenario ?? ''),
      mode: String(state.mode ?? ''),
      step: Number(session.step ?? 1),
      ttl_hours: config.demoTtlHours,
      expires_at: session.expires_at,
      is_completed: status === 'settled',
      server_now: now.toISOString(),
    },
    persona: PERSONA_VIEW,
    wish: toWishDto(fresh),
    progress: {
      current_day: startDate === '' ? 0 : demoDayOf(startDate, today, Number(fresh.days ?? DEMO_DAYS)),
      days: Number(fresh.days ?? DEMO_DAYS),
      total_tasks: total,
      done_tasks: done,
      must_total: mustTotal,
      must_done: mustDone,
      missed_tasks: tasks.filter((task) => String(task.status ?? '') === 'missed').length,
      checkin_count: tasks.filter((task) => String(task.status ?? '') === 'done').length,
      progress_bps: total > 0 ? Math.floor((done * 10_000) / total) : 0,
    },
    today_tasks: todayTasks.map(toTaskDto),
    tasks: tasks.map(toTaskDto),
    ledger,
    settlement,
    settle_open_at: endDate === '' ? '' : settleOpenAt(endDate),
  };
}

/* ── 快进 / 切结局 / 重置 ───────────────────────────────────────── */

export interface DemoActionResult {
  state: DemoStateView;
  settlement: SettlementView | null;
}

/** 快进：补齐 7 天全部任务与账本，调用真实 settleWish 自动结算（满勤 → double_realized） */
export async function fastForwardDemo(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  now: Date,
): Promise<DemoActionResult> {
  const session = await claimDemoSession(db, principal, now);
  const prepared = await prepareDemoContract(db, config, principal, now, FULL_OFFSET_DAYS);
  await completePreparedDays(db, config, principal, prepared, now, {});
  await fillDemoLedger(db, principal, prepared, now, true);
  const settled = await settlePreparedWish(db, config, prepared, now);
  await finishDemoSession(db, session, String(session.updated_at ?? ''), {
    mode: 'fast_forward',
    scenario: 'double_realized',
    step: 8,
    is_completed: true,
  }, now);
  return { state: await readDemoState(db, config, principal, now), settlement: settled };
}

/** 切换结局：double_realized / cyber_only / failed，三档都从同一套真实引擎重建并重新结算 */
export async function applyDemoScenario(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  scenario: string,
  now: Date,
): Promise<DemoActionResult> {
  if (!(DEMO_SCENARIOS as readonly string[]).includes(scenario)) {
    throw badRequest('invalid_parameter', '结局类型只能是 double_realized / cyber_only / failed。', {
      fields: { outcome: `must be one of ${DEMO_SCENARIOS.join('|')}` },
    });
  }
  const session = await claimDemoSession(db, principal, now);
  const prepared = await prepareDemoContract(db, config, principal, now, FULL_OFFSET_DAYS);
  if (scenario === 'double_realized') {
    await completePreparedDays(db, config, principal, prepared, now, {});
  } else if (scenario === 'cyber_only') {
    // 必做全部完成、钱任务留空 → 结算时惰性判为 missed → cyber_only
    await completePreparedDays(db, config, principal, prepared, now, { skipMoney: true });
  } else {
    // 前 5 天完成、后 2 天留空 → must_done < must_total → unrealized（对外场景名 failed）
    await completePreparedDays(db, config, principal, prepared, now, { throughDay: 4 });
  }
  await fillDemoLedger(db, principal, prepared, now, scenario === 'double_realized');
  const settled = await settlePreparedWish(db, config, prepared, now);
  await finishDemoSession(db, session, String(session.updated_at ?? ''), {
    mode: 'scenario',
    scenario,
    step: 8,
    is_completed: true,
  }, now);
  return { state: await readDemoState(db, config, principal, now), settlement: settled };
}

/** 重置：回到「第 3 天、2 条打卡、账本 168 元」的初始演示状态 */
export async function resetDemo(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  now: Date,
): Promise<DemoStateView> {
  const session = await claimDemoSession(db, principal, now);
  const prepared = await prepareDemoContract(db, config, principal, now, BASELINE_OFFSET_DAYS);
  await completeBaseline(db, config, principal, prepared, now);
  await finishDemoSession(db, session, String(session.updated_at ?? ''), {
    mode: 'baseline',
    scenario: 'mom_knee',
    step: 3,
    is_completed: false,
  }, now);
  return readDemoState(db, config, principal, now);
}

/* ── 预置数据编排（全部基于真实引擎） ──────────────────────────── */

interface PreparedDemo {
  wish: WishRow;
  /** 契约开始日（YYYY-MM-DD），任务日期以它为基准 */
  startDate: string;
  /** 契约时钟整体前移的天数：day_index d 的时钟 = now − (offset − d) 天 */
  offsetDays: number;
}

/**
 * 重建演示契约：删掉演示子表 → 愿签回到草稿 → 用真实 signContract 生成 7 天任务。
 * 首次进入时才创建愿签与五问答案；之后重建复用同一愿签 id，保证演示状态可反复切换。
 */
async function prepareDemoContract(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  now: Date,
  offsetDays: number,
): Promise<PreparedDemo> {
  const clock = shiftDays(now, -offsetDays);
  let wish = await findDemoWish(db, principal.userId);
  if (!wish) {
    wish = await createWish(db, config, principal, PERSONA_INPUT, clock);
    await saveAnswers(db, config, wish, PERSONA_ANSWERS, clock);
    wish = (await findWish(db, String(wish.id))) ?? wish;
  } else {
    await clearDemoChildren(db, String(wish.id));
    await resetWishToDraft(db, wish, clock);
    wish = (await findWish(db, String(wish.id))) ?? wish;
  }
  const signed = await signContract(db, wish, DEMO_DAYS, clock);
  return {
    wish: signed.wish,
    startDate: String(signed.wish.start_date ?? ''),
    offsetDays,
  };
}

/**
 * 初始人设：第 1、2 天各打一次卡（共 2 条），第一周记一笔 32 元支出，
 * 并手记 168 元省下（演示口径：预算 200 − 支出 32 = 168）。
 */
async function completeBaseline(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  prepared: PreparedDemo,
  now: Date,
): Promise<void> {
  const proof = await ensureDemoProof(db, principal.userId, prepared.wish, now);
  const wishId = String(prepared.wish.id);
  const tasks = await listTasks(db, wishId);
  const day0 = tasks.find((task) => Number(task.day_index) === 0 && String(task.side) === 'for_ta');
  const day1 = tasks.find((task) => Number(task.day_index) === 1 && String(task.side) === 'for_self');
  if (!day0 || !day1) throw conflict('demo_seed_incomplete', '演示任务没有按预期生成，请重置演示。');

  await checkinTask(db, config, principal, day0, prepared.wish, { proofId: String(proof.id), note: '' }, clockOf(now, prepared.offsetDays, 0));
  await checkinTask(db, config, principal, day1, prepared.wish, { proofId: String(proof.id), note: '' }, clockOf(now, prepared.offsetDays, 1));

  const doneTasks = (await listTasks(db, wishId)).filter((task) => isDone(String(task.status ?? '')));
  const firstWeek = String(doneTasks[0]?.week_start ?? weekStartOf(prepared.startDate));
  // 演示账本：预算 200 + 支出 32 + 手记省下 168，和产品文案「累计 168 元」保持一致
  const weekRow = await ensureWeekBudgetRow(db, prepared.wish, firstWeek, now);
  await affected(
    db.from('ledger_weeks').update({ budget_cents: 20_000, updated_at: now.toISOString() }).eq('id', String(weekRow.id)),
    'set demo week budget',
  );
  await addLedgerEntry(db, principal, prepared.wish, {
    weekStart: firstWeek,
    type: 'expense',
    amountCents: DEMO_EXPENSE_CENTS,
    note: '这一周给妈妈买了护膝和热敷贴',
    proofId: null,
    taskId: null,
  }, now);
  await addLedgerEntry(db, principal, prepared.wish, {
    weekStart: firstWeek,
    type: 'saved',
    amountCents: 16_800,
    note: '本周任务省下',
    proofId: null,
    taskId: null,
  }, now);

  await sweepMissedTasks(db, wishId, productDate(now), now);
}

interface CompletionOptions {
  /** 钱任务保持 pending，结算时按 missed 处理（cyber_only） */
  skipMoney?: boolean;
  /** 只完成到这一天（含），更晚的任务留空（failed） */
  throughDay?: number;
}

/** 按真实打卡引擎逐日补齐任务；时钟按 task_date 回拨，保证「只能打当天卡」的规则仍然生效 */
async function completePreparedDays(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  prepared: PreparedDemo,
  now: Date,
  options: CompletionOptions,
): Promise<void> {
  const proof = await ensureDemoProof(db, principal.userId, prepared.wish, now);
  const tasks = await listTasks(db, String(prepared.wish.id));
  const byDay = new Map<number, TaskRow[]>();
  for (const task of tasks) {
    const day = Number(task.day_index ?? 0);
    if (options.throughDay !== undefined && day > options.throughDay) continue;
    if (options.skipMoney === true && String(task.side) === 'money') continue;
    const list = byDay.get(day) ?? [];
    list.push(task);
    byDay.set(day, list);
  }
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const clock = clockOf(now, prepared.offsetDays, day);
    for (const task of byDay.get(day) as TaskRow[]) {
      await checkinTask(db, config, principal, task, prepared.wish, { proofId: String(proof.id), note: '' }, clock);
    }
  }
}

/** 账本补齐：每个契约周记预算 200、支出 32、手记省下 168；满勤场景再给钱任务登记兼职收入 */
async function fillDemoLedger(
  db: DbClient,
  principal: Principal,
  prepared: PreparedDemo,
  now: Date,
  earnings: boolean,
): Promise<void> {
  const fresh = (await findWish(db, String(prepared.wish.id))) ?? prepared.wish;
  const tasks = await listTasks(db, String(fresh.id));
  const weeks = [...new Set(tasks.map((task) => String(task.week_start ?? '')))].filter((week) => week !== '').sort();
  for (const week of weeks) {
    const weekRow = await ensureWeekBudgetRow(db, fresh, week, now);
    await affected(
      db.from('ledger_weeks').update({ budget_cents: 20_000, updated_at: now.toISOString() }).eq('id', String(weekRow.id)),
      'set demo week budget',
    );
    await addLedgerEntry(db, principal, fresh, {
      weekStart: week,
      type: 'expense',
      amountCents: DEMO_EXPENSE_CENTS,
      note: '这一周给妈妈买了点东西',
      proofId: null,
      taskId: null,
    }, now);
    await addLedgerEntry(db, principal, fresh, {
      weekStart: week,
      type: 'saved',
      amountCents: 16_800,
      note: '本周任务省下',
      proofId: null,
      taskId: null,
    }, now);
  }
  if (!earnings) return;
  for (const task of tasks) {
    if (String(task.side) !== 'money' || !isDone(String(task.status ?? ''))) continue;
    const amount = Math.max(1, Math.trunc(Number(task.min_budget_cents ?? 0)) || DEMO_EARNING_FALLBACK_CENTS);
    await addLedgerEntry(db, principal, fresh, {
      weekStart: String(task.week_start ?? ''),
      type: 'earning',
      amountCents: amount,
      note: '周末兼职收入',
      proofId: null,
      taskId: String(task.id),
    }, now);
  }
}

async function settlePreparedWish(
  db: DbClient,
  config: AppConfig,
  prepared: PreparedDemo,
  now: Date,
): Promise<SettlementView> {
  const fresh = await requireDemoWishRow(db, String(prepared.wish.id));
  const result = await settleWish(db, config, fresh, now);
  return result.settlement;
}

/* ── 会话行工具 ─────────────────────────────────────────────────── */

function demoPrincipal(userId: string, client: string): Principal {
  return {
    userId,
    tokenId: 'demo-seed',
    client,
    isDemo: true,
    tokenExpiresAt: new Date(0).toISOString(),
  };
}

async function requireDemoSession(db: DbClient, principal: Principal, now: Date): Promise<DemoSessionRow> {
  const row = await firstAs<DemoSessionRow>(
    db.from('demo_sessions').select('*').eq('user_id', principal.userId),
    'read demo session',
  );
  if (!row) throw notFound('demo_session_missing', '演示会话不存在，请重新创建。');
  if (isExpired(row, now)) throw unauthorized('demo_session_expired', '演示会话已过期，请重新创建。');
  return row;
}

async function requireSessionRowById(db: DbClient, demoSessionId: string): Promise<DemoSessionRow> {
  const row = await firstAs<DemoSessionRow>(
    db.from('demo_sessions').select('*').eq('id', demoSessionId),
    'read demo session by id',
  );
  if (!row) throw conflict('demo_session_unavailable', '演示环境繁忙，请稍后重试。');
  return row;
}

/** 会话状态变更的单行 CAS：抢不到说明另一个请求正在重建，直接 409 */
async function claimDemoSession(db: DbClient, principal: Principal, now: Date): Promise<DemoSessionRow> {
  const session = await requireDemoSession(db, principal, now);
  const previous = String(session.updated_at ?? '');
  const stamp = nextStamp(now, previous);
  const hit = await affected(
    db.from('demo_sessions')
      .update({ updated_at: stamp, last_seen_at: now.toISOString() })
      .eq('id', session.id).eq('updated_at', previous),
    'claim demo session',
  );
  if (hit !== 1) throw conflict('demo_session_busy', '演示状态正在切换，请稍后再试。');
  return { ...session, updated_at: stamp };
}

interface SessionStatePatch {
  mode: string;
  scenario: string;
  step: number;
  is_completed: boolean;
}

async function finishDemoSession(
  db: DbClient,
  session: DemoSessionRow,
  claimedStamp: string,
  patch: SessionStatePatch,
  now: Date,
): Promise<void> {
  const stamp = nextStamp(now, claimedStamp);
  const state = {
    mode: patch.mode,
    scenario: patch.scenario,
    step: patch.step,
    seeded_at: now.toISOString(),
  };
  const hit = await affected(
    db.from('demo_sessions').update({
      state,
      scenario: patch.scenario,
      step: patch.step,
      is_completed: patch.is_completed,
      last_seen_at: now.toISOString(),
      updated_at: stamp,
    }).eq('id', session.id).eq('updated_at', claimedStamp),
    'finish demo session',
  );
  if (hit !== 1) throw conflict('demo_session_busy', '演示状态刚被其他操作更新，请刷新后再试。');
}

function stateObject(row: DemoSessionRow): Record<string, unknown> {
  const value = row.state;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value !== '') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function nextStamp(now: Date, previous: string): string {
  const previousMs = Date.parse(previous);
  const base = Number.isNaN(previousMs) ? now.getTime() : previousMs + 1;
  return new Date(Math.max(now.getTime(), base)).toISOString();
}

/* ── 演示数据仓储 ───────────────────────────────────────────────── */

async function findDemoWish(db: DbClient, userId: string): Promise<WishRow | null> {
  return firstAs<WishRow>(
    db.from('wishes').select('*').eq('user_id', userId).eq('is_demo', true).limit(1),
    'read demo wish',
  );
}

async function requireDemoWish(db: DbClient, userId: string): Promise<WishRow> {
  const wish = await findDemoWish(db, userId);
  if (!wish) throw notFound('demo_wish_missing', '演示数据还没准备好，请重置演示。');
  return wish;
}

async function requireDemoWishRow(db: DbClient, wishId: string): Promise<WishRow> {
  const wish = await findWish(db, wishId);
  if (!wish) throw internal('演示愿签丢失，请重置演示。');
  return wish;
}

/** 重建前清空演示子表：只按 wish_id 删，wish_id 属于演示账号，物理隔离由 user_id 保证 */
async function clearDemoChildren(db: DbClient, wishId: string): Promise<void> {
  for (const table of CHILD_TABLES) {
    await mutate(db.from(table).delete().eq('wish_id', wishId), `clear demo ${table}`);
  }
}

/** 愿签回到草稿：保留五问密文与原始文本，只清契约/结算派生字段，供 signContract 重放 */
async function resetWishToDraft(db: DbClient, wish: WishRow, clock: Date): Promise<void> {
  const timestamp = clock.toISOString();
  const version = Math.trunc(Number(wish.version ?? 1)) + 1;
  const hit = await affected(
    db.from('wishes').update({
      status: 'draft',
      outcome: '',
      days: DEMO_DAYS,
      start_date: '',
      end_date: '',
      weekly_budget_cents: 0,
      sign_method: '',
      signature_file_id: null,
      signed_at: null,
      settled_at: null,
      archived_at: null,
      renew_count: 0,
      extend_mode: '',
      is_public: false,
      replies_enabled: true,
      version,
      created_at: timestamp,
      updated_at: timestamp,
    }).eq('id', String(wish.id)).eq('user_id', String(wish.user_id ?? '')),
    'reset demo wish to draft',
  );
  if (hit !== 1) throw conflict('demo_wish_missing', '演示愿签状态异常，请重新创建演示。');
}

async function ensureDemoProof(
  db: DbClient,
  userId: string,
  wish: WishRow,
  now: Date,
): Promise<FileRow> {
  const existing = await firstAs<FileRow>(
    db.from('files').select('*').eq('user_id', userId).eq('wish_id', String(wish.id)).eq('purpose', 'checkin_proof').limit(1),
    'read demo proof',
  );
  if (existing) return existing;
  const id = uuid();
  const timestamp = now.toISOString();
  const proofValues = {
    id,
    user_id: userId,
    wish_id: String(wish.id),
    purpose: 'checkin_proof',
    object_key: `demo/${String(wish.id)}/${id}.jpg`,
    status: 'ready',
    mime_type: 'image/jpeg',
    size_bytes: 12_800,
    width: 0,
    height: 0,
    sha256: await sha256Hex(utf8(`yuan-ta-demo-proof:${id}`)),
    is_public: false,
    verified_at: timestamp,
    expires_at: null,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const inserted = await write(db.from('files').insert(proofValues).select('*'), 'create demo proof');
  if (inserted.length !== 1) throw conflict('demo_seed_incomplete', '演示证明文件创建失败，请重置演示。');
  return inserted[0] as FileRow;
}

/**
 * 过期会话惰性清理：只清本 IP、最早过期的 3 条。
 * 先按 expires_at 升序再逐条确认演示账号，范围有界且绝不碰真实用户；
 * 其他 IP 的过期数据由它们自己的下一次创建顺带清理。
 */
async function purgeExpiredDemoSessions(db: DbClient, now: Date, ipHash: string | null): Promise<void> {
  const base = db.from('demo_sessions').select('*').lt('expires_at', now.toISOString());
  const scoped = ipHash ? base.eq('ip_hash', ipHash) : base;
  const expired = await rowsAs<DemoSessionRow>(
    scoped.order('expires_at', { ascending: true }).limit(PURGE_LIMIT),
    'read expired demo sessions',
  );
  for (const session of expired) {
    const userId = String(session.user_id ?? '');
    const user = userId === '' ? null : await findUser(db, userId);
    if (!user || user.is_demo !== true) {
      await mutate(db.from('demo_sessions').delete().eq('id', session.id), 'drop expired demo session');
      continue;
    }
    const wishes = await rowsAs<WishRow>(
      db.from('wishes').select('id').eq('user_id', userId).limit(20),
      'read expired demo wishes',
    );
    for (const wish of wishes) await clearDemoChildren(db, String(wish.id));
    // clearDemoChildren 故意不删 wish_answers（重建要复用五问密文），但整账号清理必须删，
    // 否则每个过期演示账号都会留下一条无人引用的密文行。
    await mutate(db.from('wish_answers').delete().eq('user_id', userId), 'drop demo answers');
    await mutate(db.from('wishes').delete().eq('user_id', userId), 'drop demo wishes');
    await mutate(db.from('files').delete().eq('user_id', userId), 'drop demo files');
    await mutate(db.from('auth_tokens').delete().eq('user_id', userId), 'drop demo tokens');
    await mutate(db.from('demo_sessions').delete().eq('id', session.id), 'drop demo session');
    await mutate(db.from('users').delete().eq('id', userId), 'drop demo user');
  }
}

/* ── 小工具 ─────────────────────────────────────────────────────── */

function isDone(status: string): boolean {
  return status === 'done' || status === 'made_up';
}

function shiftDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

function clockOf(now: Date, offsetDays: number, dayIndex: number): Date {
  return shiftDays(now, dayIndex - offsetDays);
}

/** 当前是契约第几天（1 起），超出契约期时封顶到总天数 */
function demoDayOf(startDate: string, today: string, days: number): number {
  if (startDate === '') return 0;
  const index = dayIndexOf(startDate, today) + 1;
  return Math.min(days, Math.max(1, index));
}

