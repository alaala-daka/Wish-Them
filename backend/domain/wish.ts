/**
 * 愿签仓储与状态机（PRD 3.1~3.4）。
 *
 * 状态词表：draft → active → settling → settled → archived（另有 deleted 软删）。
 * 本轮只实现 draft → active：settling 及之后由第 5 轮结算两幕写入，
 * 因此签署接口遇到 settling/settled/archived 一律按「非法状态流转」拒绝（400）。
 *
 * 一致性（平台无事务）：
 * - 签署 = 单行 CAS（`.eq('status','draft')` + affected），命中 0 行就读回真实状态再判定；
 * - 任务 id 由 (愿签, 天, 序) 派生，重复签署/崩溃补齐都走 insertIfAbsent，不会插出第二份；
 * - 五问答案一行一契约（wish_answers_wish_id_uidx），并发首提交由 insertIfAbsent + 回退更新兜住。
 *
 * 权限口径（本轮需求明确要求）：写操作先按 id 读再比对作者 ⇒ 越权 403；
 * 读操作带 owner 谓词 ⇒ 查空即 404，不泄漏「存在但不是你的」。
 */

import { affected, first, firstAs, rowsAs, write } from '../lib/db.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { encryptField } from '../lib/crypto.ts';
import { uuid } from '../lib/id.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';
import { dailyWindow, enforceWindow } from '../lib/quota.ts';
import { contractEndDate, productDate, settleOpenAt, weekStartOf } from '../lib/time.ts';
import { issueMakeupTicket, readMakeupTicket, toMakeupTicketDto } from './checkin.ts';
import { disposableBandOf, ensureWeekBudgetRow, weeklyBudgetFromBand } from './ledger.ts';
import { DEFAULT_CONTRACT_DAYS, classifyWish, deriveTitle, relationGroupOf } from './rules.ts';
import { insertPlannedTasks, listTasks, loadTaskPool, planTasks, summarizeTasks } from './task.ts';
import type { TaskRow } from './task.ts';
import type { AppConfig, DbClient, DbRow, Principal } from '../lib/types.ts';

export type WishRow = DbRow & { id: string };

/** 五问：接口字段名 → 密文列名（PRD 3.1；粗粒度档位列属第 5 轮结算，本轮留空） */
export const ANSWER_COLUMNS: Record<string, string> = {
  q1: 'q1_worry_enc',
  q2: 'q2_alone_enc',
  q3: 'q3_home_enc',
  q4: 'q4_disposable_enc',
  q5: 'q5_gift_enc',
};
const ANSWER_FIELDS = Object.keys(ANSWER_COLUMNS);

export interface NewWishInput {
  relation: string;
  nickname: string;
  pronoun: string;
  wishText: string;
}

export async function createWish(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  input: NewWishInput,
  now: Date,
): Promise<WishRow> {
  // 草稿也计数：否则「建 100 个草稿再逐个签署」可以绕过每日上限
  const window = dailyWindow(now);
  await enforceWindow(db, 'wishes', {
    column: 'user_id',
    value: principal.userId,
    since: window.since,
    limit: config.wishCreatePerDay,
    errorCode: 'wish_create_limited',
    message: `今天创建的愿签已达上限（${config.wishCreatePerDay} 个），明天再来。`,
    resetAt: window.resetAt,
    now,
  });

  const classification = classifyWish(input.wishText);
  const timestamp = now.toISOString();
  const values = {
    id: uuid(),
    user_id: principal.userId,
    status: 'draft',
    outcome: '',
    relation: input.relation,
    relation_group: relationGroupOf(input.relation),
    target_name: input.nickname,
    pronoun: input.pronoun,
    title: deriveTitle(input.wishText),
    raw_input: input.wishText,
    wish_type: classification.wishType,
    classifier_type: classification.wishType,
    classifier_confidence_bps: classification.confidenceBps,
    wish_template_id: null,
    shown_template_ids: [],
    five_questions_done: false,
    days: DEFAULT_CONTRACT_DAYS,
    start_date: '',
    end_date: '',
    weekly_budget_cents: 0,
    sign_method: '',
    signature_file_id: null,
    signed_at: null,
    source_wish_id: null,
    renew_count: 0,
    extend_mode: '',
    forked_from_post_id: null,
    is_public: false,
    replies_enabled: true,
    is_demo: principal.isDemo,
    demo_session_id: await demoSessionOf(db, principal),
    settled_at: null,
    archived_at: null,
    deleted_at: null,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const created = await write(db.from('wishes').insert(values).select('*'), 'create wish');
  if (created.length !== 1) throw conflict('wish_create_failed', '创建愿签失败，请稍后重试。');
  return created[0] as WishRow;
}

/** 演示愿签与演示会话同源：真实账号恒为 null，演示数据按 user_id 天然隔离 */
async function demoSessionOf(db: DbClient, principal: Principal): Promise<string | null> {
  if (!principal.isDemo) return null;
  const row = await first(db.from('demo_sessions').select('id').eq('user_id', principal.userId), 'read demo session');
  return row ? String(row.id) : null;
}

export async function findWish(db: DbClient, wishId: string): Promise<WishRow | null> {
  return firstAs<WishRow>(db.from('wishes').select('*').eq('id', wishId), 'read wish');
}

/** 读路径：owner 谓词查空即 404（docs/02 §3） */
export async function findOwnedWish(db: DbClient, wishId: string, userId: string): Promise<WishRow> {
  const wish = await firstAs<WishRow>(
    db.from('wishes').select('*').eq('id', wishId).eq('user_id', userId),
    'read owned wish',
  );
  if (!wish) throw notFound('wish_not_found', '找不到这个愿签。');
  return wish;
}

/** 写路径：越权明确 403，与读路径的 404 口径不同，是本轮需求的显式要求 */
export async function requireAuthor(db: DbClient, wishId: string, userId: string): Promise<WishRow> {
  const wish = await findWish(db, wishId);
  if (!wish) throw notFound('wish_not_found', '找不到这个愿签。');
  if (String(wish.user_id ?? '') !== userId) throw forbidden('wish_forbidden', '只能操作自己创建的愿签。');
  return wish;
}

export interface WishPage {
  items: Record<string, unknown>[];
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
}

/** 我的愿签：创建时间倒序 + id 升序兜底，游标分页（docs/02 §11） */
export async function listWishes(
  db: DbClient,
  userId: string,
  page: { limit: number; cursor: string | null },
): Promise<WishPage> {
  const { limit } = page;
  let found: WishRow[];
  // 列表读整行、出参只走 toWishSummary 白名单：投影点唯一，也就不必维护第二份列名清单
  if (page.cursor === null) {
    found = await rowsAs<WishRow>(
      db.from('wishes').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(limit + 1),
      'list wishes',
    );
  } else {
    const cursor = decodeCursor(page.cursor);
    // 客户端没有 or()：把「同一时间戳但 id 更大」与「时间更早」拆成两条查询再合并
    const tied = await rowsAs<WishRow>(
      db.from('wishes').select('*').eq('user_id', userId)
        .eq('created_at', cursor.sortKey).gt('id', cursor.id).order('id').limit(limit + 1),
      'list wishes at cursor time',
    );
    const older = await rowsAs<WishRow>(
      db.from('wishes').select('*').eq('user_id', userId)
        .lt('created_at', cursor.sortKey).order('created_at', { ascending: false }).limit(limit + 1),
      'list wishes before cursor',
    );
    found = [...tied, ...older];
  }
  found.sort((a, b) => {
    const left = String(a.created_at ?? '');
    const right = String(b.created_at ?? '');
    if (left !== right) return left < right ? 1 : -1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  const items = found.slice(0, limit);
  const last = items[items.length - 1];
  const hasMore = found.length > limit;
  return {
    items: items.map(toWishSummary),
    next_cursor: hasMore && last ? encodeCursor(String(last.created_at), String(last.id)) : null,
    has_more: hasMore,
    limit,
  };
}

export interface AnswersResult {
  answered: string[];
  five_questions_done: boolean;
  completed_at: string | null;
  updated_at: string;
}

/** 动态问卷的粗粒度结构化信息：只存枚举档位，不存原话 */
export interface AnswerMeta {
  giftCategory?: string;
  aloneLevel?: string;
  lastHome?: string;
  travelBand?: string;
  costBand?: string;
  disposableBand?: string;
}

const ANSWER_META_COLUMNS: Record<keyof AnswerMeta, string> = {
  giftCategory: 'q1_gift_category',
  aloneLevel: 'q2_alone_level',
  lastHome: 'q3_last_home',
  travelBand: 'q3_travel_band',
  costBand: 'q3_cost_band',
  disposableBand: 'q4_disposable_band',
};

/**
 * 保存五问答案：部分提交，未提交的字段保持原值；明文只在本次请求内存里，落库全是密文。
 * 仅 draft 可改（签署后答案锁定，否则任务与结算的依据会被事后篡改）。
 */
export async function saveAnswers(
  db: DbClient,
  config: AppConfig,
  wish: WishRow,
  input: Record<string, string>,
  now: Date,
  meta: AnswerMeta = {},
): Promise<AnswersResult> {
  if (String(wish.status ?? '') !== 'draft') {
    throw badRequest('answers_locked', '愿签已签署，五问答案不能再改。', { status: wish.status });
  }
  const timestamp = now.toISOString();
  const wishId = String(wish.id);
  const existing = await first(db.from('wish_answers').select('*').eq('wish_id', wishId), 'read wish answers');

  const answered: string[] = [];
  const cipher: Record<string, string> = {};
  for (const field of ANSWER_FIELDS) {
    const value = input[field];
    if (typeof value !== 'string' || value === '') continue;
    cipher[ANSWER_COLUMNS[field]] = await encryptField(config.fieldEncryptionKey, value, wishId);
    answered.push(field);
  }

  const stored = (field: string): string => {
    const column = ANSWER_COLUMNS[field];
    if (column in cipher) return cipher[column];
    return String(existing?.[column] ?? '');
  };
  const completed = ANSWER_FIELDS.every((field) => stored(field) !== '');
  const completedAt = completed ? String(existing?.completed_at ?? '') || timestamp : null;
  // q4 档位在第 5 轮用于推算首周预算：明文只在内存里，落库只有档位。
  // 动态问卷会直接给出 disposableBand；自由填写时仍走确定性解析。
  const q4Band = meta.disposableBand
    ?? (typeof input.q4 === 'string' && input.q4 !== '' ? disposableBandOf(input.q4) : '');

  const patch: Record<string, unknown> = { updated_at: timestamp, completed_at: completedAt };
  for (const [column, value] of Object.entries(cipher)) patch[column] = value;
  for (const [key, column] of Object.entries(ANSWER_META_COLUMNS)) {
    const value = meta[key as keyof AnswerMeta];
    if (typeof value === 'string' && value !== '') patch[column] = value.slice(0, 32);
  }
  if (q4Band !== '') patch.q4_disposable_band = q4Band;

  if (existing) {
    await write(db.from('wish_answers').update(patch).eq('wish_id', wishId).select('id'), 'update wish answers');
  } else {
    // 变量名与 createWish 的 values 区分开：check-schema-usage 按名字回查载荷，同名会查到错的表
    const answerValues: Record<string, unknown> = {
      id: uuid(),
      wish_id: wishId,
      user_id: String(wish.user_id ?? ''),
      q1_worry_enc: '',
      q1_gift_category: '',
      q2_alone_enc: '',
      q2_alone_level: '',
      q3_home_enc: '',
      q3_last_home: '',
      q3_travel_band: '',
      q3_cost_band: '',
      q4_disposable_enc: '',
      q4_disposable_band: q4Band,
      q5_gift_enc: '',
      q5_reward_id: null,
      skipped: [],
      key_version: 'v1',
      health_consent: false,
      completed_at: completedAt,
      created_at: timestamp,
      updated_at: timestamp,
    };
    for (const [column, value] of Object.entries(cipher)) answerValues[column] = value;
    for (const [key, column] of Object.entries(ANSWER_META_COLUMNS)) {
      const value = meta[key as keyof AnswerMeta];
      if (typeof value === 'string' && value !== '') answerValues[column] = value.slice(0, 32);
    }
    const inserted = await write(
      db.from('wish_answers').insertIfAbsent(answerValues, { onConflict: 'wish_id' }).select('id'),
      'insert wish answers',
    );
    // 并发首提交：另一条请求先建了行，这里改走更新，避免答案被静默丢弃
    if (inserted.length === 0) {
      await write(db.from('wish_answers').update(patch).eq('wish_id', wishId).select('id'), 'update wish answers');
    }
  }

  if (completed && wish.five_questions_done !== true) {
    await affected(
      db.from('wishes').update({ five_questions_done: true, updated_at: timestamp })
        .eq('id', wishId).eq('five_questions_done', false),
      'mark five questions done',
    );
  }
  return { answered, five_questions_done: completed, completed_at: completedAt, updated_at: timestamp };
}

export interface ContractResult {
  wish: WishRow;
  tasks: TaskRow[];
  summary: Record<string, unknown>;
  /** true = 本次首签；false = 重复签署（幂等返回成功）或崩溃后补齐任务 */
  first_sign: boolean;
  inserted_tasks: number;
  /** 签约首周的补卡券（每周一张，过期作废；后续周在访问今日页时惰性发放） */
  makeup_ticket: Record<string, unknown> | null;
}

/**
 * 签署契约：draft → active，并在同一请求里生成全部天数的任务。
 * 重复签署不报错：以首次签署的天数与开始日为准，缺任务就补齐（幂等 + 可重放）。
 */
export async function signContract(
  db: DbClient,
  wish: WishRow,
  days: number,
  now: Date,
): Promise<ContractResult> {
  const status = String(wish.status ?? '');
  if (status !== 'draft' && status !== 'active') {
    throw badRequest('wish_not_draft', '只有草稿状态的愿签能立契。', { status });
  }
  if (wish.five_questions_done !== true) {
    throw badRequest('answers_incomplete', '五问还没答完，答完才能立契。', {
      missing: await missingAnswerFields(db, String(wish.id)),
    });
  }

  const firstSign = status === 'draft';
  const wishId = String(wish.id);
  let contractDays = firstSign ? days : Number(wish.days);
  let startDate = firstSign ? productDate(now) : String(wish.start_date);
  // 首周预算由 q4 档位推算；重复签署不再覆盖用户后续手动调整的愿签默认值
  let weeklyBudgetCents = Math.max(0, Math.trunc(Number(wish.weekly_budget_cents ?? 0)));
  if (firstSign) {
    const answers = await first(
      db.from('wish_answers').select('q4_disposable_band').eq('wish_id', wishId),
      'read q4 band',
    );
    weeklyBudgetCents = weeklyBudgetFromBand(String(answers?.q4_disposable_band ?? ''));
  }
  // 先规划再 CAS：候选池为空时直接失败，不会留下「active 但没有任务」的契约
  const pool = await loadTaskPool(db, String(wish.wish_type ?? ''), String(wish.relation ?? ''));
  let planned = await planTasks(wish, contractDays, startDate, pool);

  let signed = wish;
  if (firstSign) {
    const timestamp = now.toISOString();
    const taken = await affected(
      db.from('wishes').update({
        status: 'active',
        days: contractDays,
        start_date: startDate,
        end_date: contractEndDate(startDate, contractDays),
        weekly_budget_cents: weeklyBudgetCents,
        sign_method: 'typed',
        signed_at: timestamp,
        version: Number(wish.version ?? 1) + 1,
        updated_at: timestamp,
      }).eq('id', wish.id).eq('status', 'draft'),
      'sign wish',
    );
    const fresh = await findWish(db, wishId);
    if (!fresh) throw notFound('wish_not_found', '找不到这个愿签。');
    // CAS 命中 0 行且状态不是 active ⇒ 并发改成了别的状态，交给客户端刷新
    if (taken === 0 && String(fresh.status) !== 'active') {
      throw conflict('wish_state_conflict', '愿签状态刚被改过，请刷新后重试。', { status: fresh.status });
    }
    if (taken === 0) {
      // 另一条签署请求先赢：以赢家落库的 days/start_date 重算任务，
      // 否则本次请求若带了不同的天数，会把超出契约的任务一起插进去（结算时 must_total 被抬高）。
      contractDays = Number(fresh.days);
      startDate = String(fresh.start_date);
      planned = await planTasks(fresh, contractDays, startDate, pool);
    }
    signed = fresh;
  }

  const inserted = await insertPlannedTasks(db, signed, planned, now);
  const tasks = await listTasks(db, wishId);
  // 补卡券按自然周发放：签约首周在这里直接发，后续周在 /tasks/today 惰性发
  const ticketWeek = weekStartOf(startDate);
  await issueMakeupTicket(db, signed, ticketWeek, now);
  // 账本首周行同步就位：预算从签约当周生效，后续周在首次访问/记账时补行
  await ensureWeekBudgetRow(db, signed, ticketWeek, now);
  const ticket = await readMakeupTicket(db, wishId, ticketWeek, now);
  return {
    wish: signed,
    tasks,
    summary: summarizeTasks(tasks, contractDays),
    first_sign: firstSign,
    inserted_tasks: inserted,
    makeup_ticket: ticket ? toMakeupTicketDto(ticket) : null,
  };
}

async function missingAnswerFields(db: DbClient, wishId: string): Promise<string[]> {
  const row = await first(
    db.from('wish_answers')
      .select('q1_worry_enc,q2_alone_enc,q3_home_enc,q4_disposable_enc,q5_gift_enc')
      .eq('wish_id', wishId),
    'read answer completeness',
  );
  return ANSWER_FIELDS.filter((field) => String(row?.[ANSWER_COLUMNS[field]] ?? '') === '');
}

/** 作者视角详情：永不含五问明文/密文、恢复码摘要、IP 哈希（docs/02 §10） */
export function toWishDto(wish: WishRow): Record<string, unknown> {
  const endDate = String(wish.end_date ?? '');
  return {
    id: wish.id,
    status: wish.status,
    relation: wish.relation,
    relation_group: wish.relation_group,
    nickname: wish.target_name,
    pronoun: wish.pronoun,
    title: wish.title,
    wish_text: wish.raw_input,
    wish_type: wish.wish_type,
    classifier_type: wish.classifier_type,
    classifier_confidence_bps: Number(wish.classifier_confidence_bps ?? 0),
    five_questions_done: wish.five_questions_done === true,
    days: Number(wish.days ?? 0),
    start_date: wish.start_date,
    end_date: wish.end_date,
    settle_open_at: endDate === '' ? '' : settleOpenAt(endDate),
    signed_at: wish.signed_at ?? null,
    is_public: wish.is_public === true,
    is_demo: wish.is_demo === true,
    created_at: wish.created_at,
    updated_at: wish.updated_at,
  };
}

/** 列表项：只给卡片要用的字段，原文与分类留痕不进列表 */
export function toWishSummary(wish: WishRow): Record<string, unknown> {
  return {
    id: wish.id,
    status: wish.status,
    relation: wish.relation,
    nickname: wish.target_name,
    pronoun: wish.pronoun,
    title: wish.title,
    wish_type: wish.wish_type,
    five_questions_done: wish.five_questions_done === true,
    days: Number(wish.days ?? 0),
    start_date: wish.start_date,
    end_date: wish.end_date,
    signed_at: wish.signed_at ?? null,
    is_demo: wish.is_demo === true,
    created_at: wish.created_at,
  };
}