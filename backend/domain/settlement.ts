/**
 * 结算与彩蛋（第 6 轮）。
 *
 * 状态流转（只前进）：
 *   active --结算开放（截止日次日 04:00）--> settling --落库结算快照--> settled
 *   settled --续期（仅 cyber_only / unrealized，且每年愿签一次）--> active
 *
 * 一致性（平台无事务）：
 * - active→settling 用单行 CAS（status + version），并发只有一次生效；
 * - 结算快照先 insertIfAbsent(wish_id, version) 再收尾 settling→settled，崩溃后可由 stale 接管补齐；
 * - 结算统计全部在收口前实时计算（任务状态 + 账本实时聚合），快照只用于封存展示；
 * - 续期用 `.eq(status,'settled').eq(renew_count,0)` CAS，第二次调用必然命中 0 行。
 *
 * 业务红线：
 * - 结算前任何接口都不返回礼物名称/价格/匹配结果；本文件只在 settled 之后才组装第二幕；
 * - 结局、礼物与差额文案全部是确定性代码，不调用 AI。
 */

import { affected, first, firstAs, rowsAs, write } from '../lib/db.ts';
import { badRequest, conflict, notFound, unavailable } from '../lib/errors.ts';
import { decryptField } from '../lib/crypto.ts';
import { addDays, dayIndexOf, productDate, settleOpenAt, weekStartOf } from '../lib/time.ts';
import { uuid } from '../lib/id.ts';
import { issueMakeupTicket } from './checkin.ts';
import { buildEasterEgg, type EasterEggView } from './easter-egg.ts';
import { readLedger } from './ledger.ts';
import { EXTEND_DAY_OPTIONS, MAX_EXTEND_DAYS, MIN_EXTEND_DAYS, SIDE_TO_TYPE } from './rules.ts';
import { findWish } from './wish.ts';
import { insertPlannedTasks, listTasks, loadTaskPool, planTasks, sweepMissedTasks } from './task.ts';
import type { GiftCategory } from './rules.ts';
import type { TaskRow } from './task.ts';
import type { WishRow } from './wish.ts';
import type { AppConfig, DbClient, DbRow } from '../lib/types.ts';

export type SettlementRow = DbRow & { id: string };
type RewardRow = DbRow & { id: string };

export const OUTCOME_DOUBLE = 'double_realized';
export const OUTCOME_CYBER = 'cyber_only';
export const OUTCOME_UNREALIZED = 'unrealized';

/** in_progress/settling 超过 60 秒视为崩溃残留，允许接管（与幂等表同口径） */
const SETTLE_STALE_SECONDS = 60;
const SETTLEMENTS_LIMIT = 10;
const REWARDS_LIMIT = 100;

const OUTCOME_LABELS: Record<string, string> = {
  [OUTCOME_DOUBLE]: '双重兑现',
  [OUTCOME_CYBER]: '赛博实现',
  [OUTCOME_UNREALIZED]: '未实现',
};

/** 分享页/公开池只展示结局标签，不展示礼物与金额（彩蛋不剧透） */
export function outcomeLabelOf(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? '';
}

const GAP_BANDS = {
  exact: '刚好够',
  near: '差一点',
  far: '未拆的信',
} as const;

type GapBand = keyof typeof GAP_BANDS;

/** 愿望六类 → 礼物四类；q5 没给出关键词时的确定性兜底 */
const WISH_TYPE_CATEGORY: Record<string, GiftCategory> = {
  body: 'health',
  sleep: 'health',
  lonely: 'company',
  study: 'heart',
  emotion: 'heart',
  life: 'life',
};

/** q5 礼物描述里的类别关键词；命中数最多者胜，同分按 CATEGORY_ORDER 靠前 */
const CATEGORY_ORDER: readonly GiftCategory[] = ['health', 'company', 'life', 'heart'];
const CATEGORY_HINTS: Record<GiftCategory, readonly string[]> = {
  health: ['护膝', '热敷', '按摩', '枕', '血压', '体检', '药', '艾草', '泡脚', '拖鞋', '腿', '腰'],
  company: ['回家', '车票', '陪', '电影', '电话', '话费', '火锅', '打车', '周末'],
  life: ['灯', '杯', '鞋', '修', '买菜', '家电', '保温', '夜灯'],
  heart: ['信', '相册', '书', '花', '感谢', '茶点', '合影', '打印'],
};

export interface CompletionStats {
  must_total: number;
  must_done: number;
  money_total: number;
  money_done: number;
  checkin_count: number;
  makeup_count: number;
}

export interface RewardMatch {
  reward: RewardRow;
  gap_cents: number;
  gap_bps: number;
  band: GapBand;
  hint_matched: boolean;
}

export interface SettlementView {
  wish_id: string;
  settlement_version: number;
  status: string;
  first_act: {
    outcome: string;
    outcome_label: string;
    stamped: boolean;
    settled_at: string;
    progress_ratio_bps: number;
    tasks: CompletionStats & { must_bps: number; money_bps: number; total: number; done: number };
    task_details: Record<string, unknown>[];
  };
  second_act: {
    realized_cents: number;
    realized_yuan: number;
    saved_cents: number;
    earned_cents: number;
    gift: Record<string, unknown> | null;
    gap_cents: number;
    gap_yuan: number;
    gap_band: string;
    gap_band_label: string;
    copy_text: string;
    letter_text: string;
    /** 最终彩蛋：DeepSeek 生成或确定性模板兜底，随结算快照落库 */
    easter_egg: EasterEggView | null;
  };
  extension: {
    can_extend: boolean;
    renew_count: number;
    /** 可选续期天数（结算页转盘 1~5 天） */
    allowed_days: number[];
    min_days: number;
    max_days: number;
    reason: string;
  };
}

export interface SettleOutcome {
  settlement: SettlementView;
  already_settled: boolean;
}

export interface ExtendOutcome {
  wish: WishRow;
  new_end_date: string;
  days: number;
  added_tasks: number;
  makeup_tickets: number;
  settle_open_at: string;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function intOf(row: DbRow | null | undefined, column: string): number {
  const value = Number(row?.[column] ?? 0);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function yuan(cents: number): number {
  return Math.floor(cents / 100);
}

function isDone(status: string): boolean {
  return status === 'done' || status === 'made_up';
}

/** 读结算快照时账本已不允许读（状态不再是 active），这里用一份只读副本绕开状态门禁 */
function asActive(wish: WishRow): WishRow {
  return { ...wish, status: 'active' } as WishRow;
}

async function latestSettlement(db: DbClient, wishId: string): Promise<SettlementRow | null> {
  const rows = await rowsAs<SettlementRow>(
    db.from('settlements').select('*').eq('wish_id', wishId).limit(SETTLEMENTS_LIMIT),
    'read settlements',
  );
  return rows.sort((a, b) => intOf(b, 'version') - intOf(a, 'version'))[0] ?? null;
}

async function maxSettlementVersion(db: DbClient, wishId: string): Promise<number> {
  const latest = await latestSettlement(db, wishId);
  return latest ? intOf(latest, 'version') : 0;
}

async function requireWishRow(db: DbClient, wishId: string): Promise<WishRow> {
  const fresh = await findWish(db, wishId);
  if (!fresh) throw notFound('wish_not_found', '找不到这个愿签。');
  return fresh;
}

function isStaleSettling(wish: WishRow, now: Date): boolean {
  const updatedAt = Date.parse(text(wish.updated_at));
  return Number.isNaN(updatedAt) || now.getTime() - updatedAt > SETTLE_STALE_SECONDS * 1000;
}

/** 结局判定：必做任务先决，钱任务只区分「双重兑现 / 赛博实现」 */
export function decideOutcome(stats: CompletionStats): string {
  if (stats.must_total === 0 || stats.must_done < stats.must_total) return OUTCOME_UNREALIZED;
  if (stats.money_done < stats.money_total) return OUTCOME_CYBER;
  return OUTCOME_DOUBLE;
}

export function summarizeCompletion(tasks: TaskRow[]): CompletionStats {
  let mustTotal = 0;
  let mustDone = 0;
  let moneyTotal = 0;
  let moneyDone = 0;
  let checkinCount = 0;
  let makeupCount = 0;
  for (const task of tasks) {
    const status = text(task.status);
    const isMust = task.is_must === true;
    const isMoney = text(task.side) === 'money';
    if (isMust) mustTotal += 1;
    if (isMoney) moneyTotal += 1;
    if (isMust && isDone(status)) mustDone += 1;
    if (isMoney && isDone(status)) moneyDone += 1;
    if (status === 'done') checkinCount += 1;
    if (status === 'made_up') makeupCount += 1;
  }
  return {
    must_total: mustTotal,
    must_done: mustDone,
    money_total: moneyTotal,
    money_done: moneyDone,
    checkin_count: checkinCount,
    makeup_count: makeupCount,
  };
}

/** q5 是密文；解不开（密钥轮换/损坏）时退回愿望类型，不让结算因此 500 */
async function readGiftHint(db: DbClient, config: AppConfig, wishId: string): Promise<string> {
  const row = await first(db.from('wish_answers').select('q5_gift_enc').eq('wish_id', wishId), 'read gift hint');
  const stored = text(row?.q5_gift_enc);
  if (stored === '') return '';
  try {
    return await decryptField(config.fieldEncryptionKey, stored, wishId);
  } catch {
    return '';
  }
}

export function giftCategoryOf(wishType: string, hint: string): GiftCategory {
  let best: GiftCategory | null = null;
  let bestScore = 0;
  for (const category of CATEGORY_ORDER) {
    const score = CATEGORY_HINTS[category].filter((word) => hint.includes(word)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  if (best !== null) return best;
  return WISH_TYPE_CATEGORY[wishType] ?? 'heart';
}

function rewardOrder(a: RewardRow, b: RewardRow): number {
  const order = intOf(a, 'sort_order') - intOf(b, 'sort_order');
  if (order !== 0) return order;
  const min = intOf(a, 'min_cents') - intOf(b, 'min_cents');
  if (min !== 0) return min;
  const max = intOf(a, 'max_cents') - intOf(b, 'max_cents');
  if (max !== 0) return max;
  return text(a.id) < text(b.id) ? -1 : 1;
}

async function loadRewards(db: DbClient, category: string): Promise<RewardRow[]> {
  const found = await rowsAs<RewardRow>(
    db.from('rewards')
      .select('id,category,title,note,min_cents,max_cents,sort_order')
      .eq('is_active', true)
      .eq('category', category)
      .limit(REWARDS_LIMIT),
    'read reward pool',
  );
  return found.sort(rewardOrder);
}

function cleanGiftText(value: string): string {
  return value.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
}

/**
 * q5 直接点名礼物时优先：标题的连续片段或任意二字片段出现在 q5 里。
 * 这是「由愿望类型 + 五问答案确定礼物」的确定性细化，不改变候选池的价格过滤。
 */
function hintMatchOf(rewards: RewardRow[], hint: string): RewardRow | null {
  const normalized = cleanGiftText(hint);
  if (normalized === '') return null;
  let best: RewardRow | null = null;
  let bestLength = 0;
  for (const reward of rewards) {
    const title = text(reward.title);
    let length = 0;
    for (const part of title.split(/[\/+、\s]+/)) {
      const clean = cleanGiftText(part);
      if (clean.length >= 2 && normalized.includes(clean)) length = Math.max(length, clean.length);
    }
    const titleChars = cleanGiftText(title);
    for (let index = 0; index + 2 <= titleChars.length; index += 1) {
      if (normalized.includes(titleChars.slice(index, index + 2))) length = Math.max(length, 2);
    }
    if (length > bestLength) {
      best = reward;
      bestLength = length;
    }
  }
  return bestLength >= 2 ? best : null;
}

function gapOf(reward: RewardRow, realizedCents: number): { gap: number; bps: number; band: GapBand } {
  const min = intOf(reward, 'min_cents');
  const max = intOf(reward, 'max_cents');
  const median = Math.floor((min + max) / 2);
  const gap = Math.max(0, median - realizedCents);
  const bps = median > 0 ? Math.floor((gap * 10_000) / median) : gap > 0 ? 10_000 : 0;
  const band: GapBand = bps <= 1_000 ? 'exact' : bps <= 3_000 ? 'near' : 'far';
  return { gap, bps, band };
}

/** 礼物匹配：类别 → 最低价 ≤ 累计兑现 → q5 点名优先 → 价格上限最高；差额 >30% 落到「未拆的信」 */
export function matchReward(rewards: RewardRow[], realizedCents: number, hint: string): RewardMatch {
  if (rewards.length === 0) throw unavailable('reward_pool_empty', '礼物目录还没准备好，请先导入种子数据。');
  const sorted = [...rewards].sort(rewardOrder);
  const cheapest = sorted.reduce((best, item) => {
    const min = intOf(item, 'min_cents');
    const bestMin = intOf(best, 'min_cents');
    if (min !== bestMin) return min < bestMin ? item : best;
    const max = intOf(item, 'max_cents');
    const bestMax = intOf(best, 'max_cents');
    if (max !== bestMax) return max < bestMax ? item : best;
    return best;
  }, sorted[0]);

  const affordable = sorted.filter((reward) => intOf(reward, 'min_cents') <= realizedCents);
  if (affordable.length === 0) {
    const priced = gapOf(cheapest, realizedCents);
    return { reward: cheapest, gap_cents: priced.gap, gap_bps: priced.bps, band: 'far', hint_matched: false };
  }

  const hinted = hintMatchOf(affordable, hint);
  let chosen = hinted;
  if (chosen === null) {
    chosen = affordable.reduce((best, item) => {
      const max = intOf(item, 'max_cents');
      const bestMax = intOf(best, 'max_cents');
      if (max !== bestMax) return max > bestMax ? item : best;
      const min = intOf(item, 'min_cents');
      const bestMin = intOf(best, 'min_cents');
      return min > bestMin ? item : best;
    }, affordable[0]);
  }

  let priced = gapOf(chosen, realizedCents);
  let gainedHint = hinted !== null && chosen === hinted;
  if (priced.band === 'far') {
    chosen = cheapest;
    priced = gapOf(chosen, realizedCents);
    gainedHint = false;
    priced = { ...priced, band: 'far' };
  }
  return { reward: chosen, gap_cents: priced.gap, gap_bps: priced.bps, band: priced.band, hint_matched: gainedHint };
}

function copyTextOf(band: GapBand, gift: RewardRow, realizedCents: number, gapCents: number, summary: Record<string, unknown>): string {
  const title = text(gift.title);
  const min = yuan(intOf(gift, 'min_cents'));
  const max = yuan(intOf(gift, 'max_cents'));
  const median = yuan(Math.floor((intOf(gift, 'min_cents') + intOf(gift, 'max_cents')) / 2));
  const realized = yuan(realizedCents);
  if (band === 'exact') return `刚好够：累计兑现 ¥${realized}，正好落在「${title}」的 ¥${min}–¥${max} 区间里。`;
  const gap = yuan(gapCents);
  if (band === 'near') {
    const weekly = Number(summary.weekly_saved_yuan ?? 0);
    const weeks = Number(summary.weeks_needed ?? 0);
    const tip = weekly > 0 && weeks > 0
      ? `按每周约 ¥${weekly} 的结余，大约 ${weeks} 周就攒够了。`
      : '再记几笔兼职收入，很快就能补上。';
    return `差一点：累计兑现 ¥${realized}，离「${title}」的中位价 ¥${median} 还差 ¥${gap}。${tip}`;
  }
  return `这封「未拆的信」先留在这里：累计兑现 ¥${realized}，离「${title}」的中位价 ¥${median} 还差 ¥${gap}。`;
}

function letterOf(
  outcome: string,
  band: GapBand,
  wish: WishRow,
  gift: RewardRow,
  realizedCents: number,
  focusTitle = '',
): string {
  const name = text(wish.target_name) || 'TA';
  const title = text(wish.title) || '替 TA 许的愿';
  const realized = yuan(realizedCents);
  // 有彩蛋时信件跟着彩蛋的具体落点走，避免信里还提旧礼物名
  const giftTitle = focusTitle || text(gift.title);
  if (outcome === OUTCOME_DOUBLE) {
    return `致 ${name}：\n这 ${intOf(wish, 'days')} 天里，我把每一件答应过的小事都做完了，也攒下了 ¥${realized}。\n「${title}」不是一句空话——它现在有了具体的落点：${giftTitle}。\n签收的时候，请把这张信纸也收好。`;
  }
  if (outcome === OUTCOME_CYBER) {
    return `致 ${name}：\n必做的每一天我都没有缺席，只是有些钱还没攒够。\n现在手里是 ¥${realized}，离「${giftTitle}」${band === 'exact' ? '已经够得着了' : '还差一点点'}。\n这封信先不拆。等我把它亲手交给你。`;
  }
  return `致 ${name}：\n这段时间我做得不够好，有些日子没能坚持下来。\n但「${title}」我没有忘，账本里的 ¥${realized} 也还在。\n如果你愿意，我想再试一次。`;
}

function summaryFor(
  wish: WishRow,
  outcome: string,
  band: GapBand,
  gift: RewardRow,
  gap: number,
  ledgerSaved: number,
  countedWeeks: number,
): Record<string, unknown> {
  const weeklySaved = countedWeeks > 0 ? Math.floor(ledgerSaved / countedWeeks) : 0;
  return {
    weekly_saved_yuan: yuan(weeklySaved),
    weeks_needed: weeklySaved > 0 ? Math.ceil(gap / weeklySaved) : 0,
    gap_band_label: GAP_BANDS[band],
    outcome_label: OUTCOME_LABELS[outcome] ?? outcome,
    gift_title: text(gift.title),
    days: intOf(wish, 'days'),
  };
}

function summaryObject(row: SettlementRow): Record<string, unknown> {
  const value = row.self_summary;
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

async function finalizeSettled(db: DbClient, wishId: string, outcome: string, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  await affected(
    db.from('wishes').update({ status: 'settled', outcome, settled_at: timestamp, updated_at: timestamp })
      .eq('id', wishId).eq('status', 'settling'),
    'finalize settlement',
  );
}

/**
 * 触发结算：active → settling → settled。
 * 已结算的重复调用直接返回快照，不重新计算；没有快照的 settled/settling 由 stale 路径补齐。
 */
export async function settleWish(
  db: DbClient,
  config: AppConfig,
  wish: WishRow,
  now: Date,
): Promise<SettleOutcome> {
  const wishId = text(wish.id);
  let current = wish;
  const status = text(wish.status);

  if (status === 'settled') {
    const existing = await latestSettlement(db, wishId);
    if (!existing) throw conflict('settlement_missing', '结算记录缺失，请联系客服核对。', { wish_id: wishId });
    return { settlement: await toSettlementView(db, current, existing), already_settled: true };
  }

  if (status === 'settling') {
    const existing = await latestSettlement(db, wishId);
    if (existing) {
      // 崩溃窗口：快照已落库但状态没收尾，这里补一次 CAS 再返回
      await finalizeSettled(db, wishId, text(existing.outcome), now);
      return {
        settlement: await toSettlementView(db, await requireWishRow(db, wishId), existing),
        already_settled: true,
      };
    }
    if (!isStaleSettling(current, now)) {
      throw conflict('settlement_in_progress', '结算正在处理中，请稍后刷新。', { retryAfterSeconds: 2 });
    }
    const claimed = await affected(
      db.from('wishes').update({ updated_at: now.toISOString() })
        .eq('id', wishId).eq('status', 'settling').eq('updated_at', text(current.updated_at)),
      'claim stale settlement',
    );
    if (claimed !== 1) {
      throw conflict('settlement_in_progress', '结算正在处理中，请稍后刷新。', { retryAfterSeconds: 2 });
    }
  } else if (status !== 'active') {
    throw badRequest('wish_not_active', '只有进行中的愿签才能结算。', { status });
  }

  const endDate = text(current.end_date);
  if (endDate === '') throw badRequest('wish_not_active', '愿签还没有契约期，不能结算。', { status });
  const openAt = settleOpenAt(endDate);
  const openMs = Date.parse(openAt);
  if (now.getTime() < openMs) {
    throw badRequest('settle_too_early', '还没到结算时间，截止日次日 04:00 后才能结算。', {
      end_date: endDate,
      settle_open_at: openAt,
      seconds_remaining: Math.ceil((openMs - now.getTime()) / 1000),
    });
  }

  await sweepMissedTasks(db, wishId, productDate(now), now);
  const tasks = await listTasks(db, wishId);
  const stats = summarizeCompletion(tasks);
  const outcome = decideOutcome(stats);
  const ledger = await readLedger(db, asActive(current), null, now);
  const realized = ledger.totals.realized_cents;
  // 彩蛋在结算时生成一次并存快照；失败/超时自动回退模板，不阻塞结算
  const easterEgg = await buildEasterEgg(db, config, current, {
    realizedCents: ledger.totals.realized_cents,
    savedCents: ledger.totals.saved_cents,
    earnedCents: ledger.totals.income_cents,
  }, now);
  const hint = await readGiftHint(db, config, wishId);
  const category = giftCategoryOf(text(current.wish_type), hint);
  const rewards = await loadRewards(db, category);
  const match = matchReward(rewards, realized, hint);

  // active → settling：status + version 双谓词，并发只有一个能命中
  let claimed = status === 'settling';
  for (let attempt = 0; !claimed && attempt < 3; attempt += 1) {
    const version = intOf(current, 'version') || 1;
    const timestamp = now.toISOString();
    const hit = await affected(
      db.from('wishes').update({ status: 'settling', version: version + 1, updated_at: timestamp })
        .eq('id', wishId).eq('status', 'active').eq('version', version),
      'claim settlement',
    );
    if (hit === 1) {
      claimed = true;
      break;
    }
    const fresh = await requireWishRow(db, wishId);
    const freshStatus = text(fresh.status);
    if (freshStatus === 'settled') {
      const existing = await latestSettlement(db, wishId);
      if (!existing) throw conflict('settlement_missing', '结算记录缺失，请联系客服核对。', { wish_id: wishId });
      return { settlement: await toSettlementView(db, fresh, existing), already_settled: true };
    }
    if (freshStatus === 'settling') {
      const existing = await latestSettlement(db, wishId);
      if (existing) {
        await finalizeSettled(db, wishId, text(existing.outcome), now);
        return {
          settlement: await toSettlementView(db, await requireWishRow(db, wishId), existing),
          already_settled: true,
        };
      }
      throw conflict('settlement_in_progress', '结算正在处理中，请稍后刷新。', { retryAfterSeconds: 2 });
    }
    if (freshStatus !== 'active') {
      throw badRequest('wish_not_active', '只有进行中的愿签才能结算。', { status: freshStatus });
    }
    current = fresh;
  }
  if (!claimed) throw conflict('wish_state_conflict', '愿签状态刚被更新过，请刷新后重试。');

  const version = (await maxSettlementVersion(db, wishId)) + 1;
  const timestamp = now.toISOString();
  const summary = summaryFor(current, outcome, match.band, match.reward, match.gap_cents, ledger.totals.saved_cents, ledger.totals.counted_weeks);
  summary.copy_text = copyTextOf(match.band, match.reward, realized, match.gap_cents, summary);
  summary.letter_template = letterOf(outcome, match.band, current, match.reward, realized, easterEgg.title);
  summary.matched_by = match.hint_matched ? 'gift_hint' : 'price_range';
  summary.gift_category = text(match.reward.category);
  summary.easter_egg = easterEgg;

  const rowValues = {
    id: uuid(),
    wish_id: wishId,
    user_id: text(current.user_id),
    version,
    outcome,
    must_total: stats.must_total,
    must_done: stats.must_done,
    money_total: stats.money_total,
    money_done: stats.money_done,
    checkin_count: stats.checkin_count,
    makeup_count: stats.makeup_count,
    budget_cents: ledger.totals.budget_cents,
    spent_cents: ledger.totals.spent_cents,
    saved_cents: ledger.totals.saved_cents,
    earned_cents: ledger.totals.income_cents,
    total_cents: realized,
    reward_id: text(match.reward.id),
    reward_min_cents: intOf(match.reward, 'min_cents'),
    reward_max_cents: intOf(match.reward, 'max_cents'),
    gap_cents: match.gap_cents,
    gap_band: match.band,
    progress_ratio_bps: ratioBps(stats),
    self_summary: summary,
    letter_text: String(summary.letter_template ?? ''),
    letter_updated_at: null,
    card_file_id: null,
    letter_file_id: null,
    sealed: false,
    sealed_at: null,
    revealed_at: null,
    computed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const inserted = await write(
    db.from('settlements').insertIfAbsent(rowValues, { onConflict: 'wish_id,version' }).select('*'),
    'create settlement',
  );
  let row = inserted[0] as SettlementRow | undefined;
  if (!row) {
    const raced = await firstAs<SettlementRow>(
      db.from('settlements').select('*').eq('wish_id', wishId).eq('version', version),
      'reread settlement',
    );
    if (!raced) throw conflict('settlement_conflict', '结算记录刚被写入，请刷新后重试。');
    row = raced;
  }

  await finalizeSettled(db, wishId, outcome, now);
  const fresh = await requireWishRow(db, wishId);
  return { settlement: await toSettlementView(db, fresh, row), already_settled: false };
}

function ratioBps(stats: CompletionStats): number {
  const total = stats.must_total + stats.money_total;
  const done = stats.must_done + stats.money_done;
  return total > 0 ? Math.floor((done * 10_000) / total) : 0;
}

/** 获取结算结果：只有 settled 才组装两幕；其余状态不读、不泄露任何礼物字段 */
export async function readSettlement(db: DbClient, wish: WishRow): Promise<SettlementView> {
  const status = text(wish.status);
  if (status !== 'settled') {
    throw badRequest('wish_not_settled', '愿签还没结算，暂时没有结算结果。', { status });
  }
  const row = await latestSettlement(db, text(wish.id));
  if (!row) throw conflict('settlement_missing', '结算记录缺失，请联系客服核对。', { wish_id: wish.id });
  return toSettlementView(db, wish, row);
}

async function toSettlementView(db: DbClient, wish: WishRow, row: SettlementRow): Promise<SettlementView> {
  const wishId = text(wish.id);
  const outcome = text(row.outcome);
  const tasks = await listTasks(db, wishId);
  const reward = row.reward_id
    ? await firstAs<RewardRow>(
      db.from('rewards').select('id,category,title,note,min_cents,max_cents')
        .eq('id', text(row.reward_id)),
      'read settlement reward',
    )
    : null;
  const summary = summaryObject(row);
  const min = intOf(row, 'reward_min_cents');
  const max = intOf(row, 'reward_max_cents');
  const median = Math.floor((min + max) / 2);
  const gap = intOf(row, 'gap_cents');
  const band = (text(row.gap_band) || 'far') as GapBand;
  const realized = intOf(row, 'total_cents');
  const renewCount = intOf(wish, 'renew_count');
  const canExtend = outcome !== OUTCOME_DOUBLE && renewCount < 1;
  const taskStats = summarizeCompletion(tasks);
  const storedStats: CompletionStats = {
    must_total: intOf(row, 'must_total'),
    must_done: intOf(row, 'must_done'),
    money_total: intOf(row, 'money_total'),
    money_done: intOf(row, 'money_done'),
    checkin_count: intOf(row, 'checkin_count'),
    makeup_count: intOf(row, 'makeup_count'),
  };

  return {
    wish_id: wishId,
    settlement_version: intOf(row, 'version'),
    status: 'settled',
    first_act: {
      outcome,
      outcome_label: OUTCOME_LABELS[outcome] ?? outcome,
      stamped: outcome === OUTCOME_DOUBLE || outcome === OUTCOME_CYBER,
      settled_at: text(wish.settled_at) || text(row.computed_at),
      progress_ratio_bps: intOf(row, 'progress_ratio_bps'),
      tasks: {
        ...storedStats,
        must_bps: storedStats.must_total > 0 ? Math.floor((storedStats.must_done * 10_000) / storedStats.must_total) : 0,
        money_bps: storedStats.money_total > 0 ? Math.floor((storedStats.money_done * 10_000) / storedStats.money_total) : 0,
        total: storedStats.must_total + storedStats.money_total,
        done: storedStats.must_done + storedStats.money_done,
      },
      task_details: tasks.map((task) => ({
        id: task.id,
        day_index: Number(task.day_index ?? 0),
        task_date: task.task_date,
        type: SIDE_TO_TYPE[text(task.side) as keyof typeof SIDE_TO_TYPE] ?? 'ta',
        title: task.text,
        status: task.status,
        is_must: task.is_must === true,
      })),
    },
    second_act: {
      realized_cents: realized,
      realized_yuan: yuan(realized),
      saved_cents: intOf(row, 'saved_cents'),
      earned_cents: intOf(row, 'earned_cents'),
      gift: row.reward_id
        ? {
          id: text(row.reward_id),
          category: text(reward?.category) || text(summary.gift_category),
          title: text(reward?.title) || text(summary.gift_title),
          note: text(reward?.note),
          min_cents: min,
          max_cents: max,
          min_yuan: yuan(min),
          max_yuan: yuan(max),
          price_median_cents: median,
          price_median_yuan: yuan(median),
        }
        : null,
      gap_cents: gap,
      gap_yuan: yuan(gap),
      gap_band: band,
      gap_band_label: GAP_BANDS[band] ?? text(summary.gap_band_label),
      copy_text: text(summary.copy_text) || copyTextOf(band, { id: '', min_cents: min, max_cents: max, title: text(reward?.title) } as RewardRow, realized, gap, summary),
      letter_text: text(row.letter_text) || text(summary.letter_template),
      easter_egg: (summary.easter_egg && typeof summary.easter_egg === 'object')
        ? summary.easter_egg as EasterEggView
        : null,
    },
    extension: {
      can_extend: canExtend,
      renew_count: renewCount,
      allowed_days: [...EXTEND_DAY_OPTIONS],
      min_days: MIN_EXTEND_DAYS,
      max_days: MAX_EXTEND_DAYS,
      reason: canExtend
        ? ''
        : outcome === OUTCOME_DOUBLE
          ? '双重兑现的愿签不需要续期。'
          : renewCount >= 1 ? '每个愿签只能续期一次。' : '当前状态不能续期。',
    },
  };
}

/**
 * 续期：仅赛博实现 / 未实现，且每个愿签一次。
 * 截止日 +7 天、回到 active，补生成新增天数的任务（派生 id 自动跳过已有任务），并补发对应周的补卡券。
 */
export async function extendWish(db: DbClient, wish: WishRow, days: number, now: Date): Promise<ExtendOutcome> {
  if (!Number.isInteger(days) || days < MIN_EXTEND_DAYS || days > MAX_EXTEND_DAYS) {
    throw badRequest('invalid_parameter', `续期天数只能是 ${MIN_EXTEND_DAYS}~${MAX_EXTEND_DAYS} 天。`, {
      fields: { days: `${MIN_EXTEND_DAYS}..${MAX_EXTEND_DAYS}` },
    });
  }
  const wishId = text(wish.id);
  const status = text(wish.status);
  // 先判次数：第一次续期后状态回到 active，第二次调用应明确提示「只能续期一次」
  const renewCount = intOf(wish, 'renew_count');
  if (renewCount >= 1) {
    throw badRequest('extend_limit_reached', '每个愿签只能续期一次。', { renew_count: renewCount });
  }
  if (status !== 'settled') {
    throw badRequest('wish_not_settled', '愿签还没结算，不能续期。', { status });
  }
  const latest = await latestSettlement(db, wishId);
  if (!latest) throw badRequest('wish_not_settled', '愿签还没结算，不能续期。', { status });
  const outcome = text(latest.outcome);
  if (outcome === OUTCOME_DOUBLE) {
    throw badRequest('extend_not_allowed', '双重兑现的愿签不需要续期。', { outcome });
  }
  if (outcome !== OUTCOME_CYBER && outcome !== OUTCOME_UNREALIZED) {
    throw badRequest('extend_not_allowed', '当前结局不支持续期。', { outcome });
  }

  const startDate = text(wish.start_date);
  const oldEnd = text(wish.end_date);
  if (startDate === '' || oldEnd === '') {
    throw badRequest('wish_not_active', '愿签没有完整的契约期，不能续期。', { status });
  }
  const newEnd = addDays(oldEnd, days);
  const newDays = dayIndexOf(startDate, newEnd) + 1;
  const version = intOf(wish, 'version') || 1;
  const timestamp = now.toISOString();
  const extended = await affected(
    db.from('wishes').update({
      status: 'active',
      end_date: newEnd,
      days: newDays,
      renew_count: 1,
      extend_mode: `extend_${days}d`,
      outcome: '',
      settled_at: null,
      version: version + 1,
      updated_at: timestamp,
    }).eq('id', wishId).eq('status', 'settled').eq('renew_count', 0),
    'extend wish',
  );
  if (extended !== 1) {
    const fresh = await requireWishRow(db, wishId);
    if (intOf(fresh, 'renew_count') >= 1) {
      throw badRequest('extend_limit_reached', '每个愿签只能续期一次。', { renew_count: intOf(fresh, 'renew_count') });
    }
    if (text(fresh.status) !== 'settled') {
      throw badRequest('wish_not_settled', '愿签还没结算，不能续期。', { status: fresh.status });
    }
    throw conflict('wish_state_conflict', '愿签状态刚被更新过，请刷新后重试。', { status: fresh.status });
  }

  const fresh = await requireWishRow(db, wishId);
  // 续期不是重签：沿用原开始日，planTasks 对已有天数会得到同一批派生 id，insertIfAbsent 只补新增天数
  const pool = await loadTaskPool(db, text(fresh.wish_type), text(fresh.relation));
  const planned = await planTasks(fresh, newDays, startDate, pool);
  const addedTasks = await insertPlannedTasks(db, fresh, planned, now);

  let makeupTickets = 0;
  for (let week = weekStartOf(addDays(oldEnd, 1)); week <= weekStartOf(newEnd); week = addDays(week, 7)) {
    await issueMakeupTicket(db, fresh, week, now);
    makeupTickets += 1;
  }
  return {
    wish: fresh,
    new_end_date: newEnd,
    days,
    added_tasks: addedTasks,
    makeup_tickets: makeupTickets,
    settle_open_at: settleOpenAt(newEnd),
  };
}