/**
 * 任务生成引擎（PRD 5.3）：签署那一刻一次性生成全部天数的任务，之后不动态变更。
 *
 * 三条硬规则：
 * 1) 每天两条必做（1 条为 TA + 1 条为自己），周六周日额外一条可选钱任务；
 * 2) 按「愿望类型 × 关系」选候选池，同一愿签内标题不重复；
 * 3) 全程确定性：随机源 = SHA-256(wish_id) 派生的 mulberry32，任务 id = SHA-256(wish_id:天:序)。
 *    ⇒ 幂等重试、崩溃后补齐都会得到同一批任务，insertIfAbsent 天然去重，不需要事务。
 *
 * 候选池耗尽（30 天契约）时按用户确认的口径生成「轮转副本」：
 * 文案追加「（第N轮）」、rotation 记轮次、template_id 置 NULL（唯一索引允许多个 NULL），
 * 因此 tasks_wish_template_uidx 与 tasks_wish_text_uidx 都仍然成立。
 *
 * 规划与落库分成两步：planTasks 是纯函数（只读候选池），签署接口先规划再 CAS，
 * 避免「状态已 active 但任务生成失败」这种没有任务的契约。
 */

import { affected, firstAs, rowsAs, write } from '../lib/db.ts';
import { unavailable } from '../lib/errors.ts';
import { sha256Hex, utf8 } from '../lib/crypto.ts';
import { derivedUuid } from '../lib/id.ts';
import { addDays, isWeekendDate, weekStartOf } from '../lib/time.ts';
import {
  MUST_SIDES,
  SIDE_SEQ,
  SIDE_TO_TYPE,
  deriveMoneyKind,
  deriveTaskTags,
  rotationTitle,
  seededRandom,
  shuffleWith,
} from './rules.ts';
import type { TaskSide } from './rules.ts';
import type { DbClient, DbRow } from '../lib/types.ts';

export type TaskRow = DbRow & { id: string };
export type TaskTemplateRow = DbRow & { id: string };

/** 单类型候选池上限：种子共 120 条、单类型 20 条，200 足够且不会全表扫 */
const POOL_LIMIT = 200;
/** 单契约任务上限：30 天 × 3 条 = 90，留一倍余量 */
const TASKS_PER_WISH_LIMIT = 200;
const ALL_SIDES: readonly TaskSide[] = ['for_ta', 'for_self', 'money'];

/** 候选池：启用的本类型模板（含 'any' 通用类型），关系专属模板只进对应关系的候选 */
export async function loadTaskPool(db: DbClient, wishType: string, relation: string): Promise<TaskTemplateRow[]> {
  const found = await rowsAs<TaskTemplateRow>(
    db.from('task_templates')
      .select('id,wish_type,relation,side,text,proof_kind,time_slot,weekend_only,min_budget_cents,tags,money_kind,sort_order')
      .eq('is_active', true)
      .in('wish_type', [wishType, 'any'])
      .limit(POOL_LIMIT),
    'read task pool',
  );
  return found.filter((tpl) => !tpl.relation || tpl.relation === relation);
}

export interface PlannedTask {
  day_index: number;
  task_date: string;
  week_start: string;
  side: TaskSide;
  seq: number;
  text: string;
  proof_kind: string;
  time_slot: string;
  min_budget_cents: number;
  /** 任务标签（1~3 个，2~3 字）；模板没写时由规则派生 */
  tags: string[];
  /** 钱任务口径：save / earn；非钱任务为空字符串 */
  money_kind: string;
  template_id: string | null;
  rotation: number;
  is_must: boolean;
  is_for_self: boolean;
}

interface Deck {
  templates: TaskTemplateRow[];
  cursor: number;
  rotation: number;
}

/**
 * 抽牌堆：关系专属优先、通用兜底，两档各自洗牌后拼接。
 * 排序键固定 (专属优先, sort_order, id)，与数据库返回顺序无关 ⇒ 同一愿签重放得到同一副牌。
 */
function buildDeck(pool: TaskTemplateRow[], side: TaskSide, relation: string, random: () => number): Deck {
  const ordered = pool
    .filter((tpl) => tpl.side === side)
    .sort((a, b) => {
      const specific = Number(b.relation === relation) - Number(a.relation === relation);
      if (specific !== 0) return specific;
      const order = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      if (order !== 0) return order;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    });
  const tailored = ordered.filter((tpl) => tpl.relation === relation);
  const generic = ordered.filter((tpl) => tpl.relation !== relation);
  return { templates: [...shuffleWith(tailored, random), ...shuffleWith(generic, random)], cursor: 0, rotation: 0 };
}

/** 模板标签可能是 jsonb 数组或 JSON 字符串；为空时用规则确定性派生 */
function tagsOf(template: TaskTemplateRow, wishType: string, side: string, text: string, moneyKind: string): string[] {
  const raw = template.tags;
  if (Array.isArray(raw)) {
    const tags = raw.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
    if (tags.length > 0) return tags.slice(0, 3);
  }
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const tags = parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
        if (tags.length > 0) return tags.slice(0, 3);
      }
    } catch {
      // 坏数据回退派生，不让任务生成失败
    }
  }
  return deriveTaskTags({ wishType, side, text, moneyKind });
}

/** 取下一张；一轮取完就进入下一轮（轮转副本），rotation 即轮次 */
function draw(deck: Deck): { template: TaskTemplateRow; rotation: number } {
  if (deck.cursor >= deck.templates.length) {
    deck.cursor = 0;
    deck.rotation += 1;
  }
  const template = deck.templates[deck.cursor];
  deck.cursor += 1;
  return { template, rotation: deck.rotation };
}

/** 纯规划：不写库。必做两档没有候选就直接失败，签署接口据此在 CAS 之前拦住 */
export async function planTasks(wish: DbRow, days: number, startDate: string, pool: TaskTemplateRow[]): Promise<PlannedTask[]> {
  const wishId = String(wish.id ?? '');
  const relation = String(wish.relation ?? '');
  const wishType = String(wish.wish_type ?? '');
  const seedHex = await sha256Hex(utf8(`yuan-ta-task-v1:${wishId}`));
  const random = seededRandom(Number.parseInt(seedHex.slice(0, 8), 16));
  const decks = new Map<TaskSide, Deck>();
  for (const side of ALL_SIDES) decks.set(side, buildDeck(pool, side, relation, random));
  for (const side of MUST_SIDES) {
    if ((decks.get(side) as Deck).templates.length === 0) {
      throw unavailable('task_pool_empty', '任务模板池还没准备好，请先导入种子数据。');
    }
  }

  const planned: PlannedTask[] = [];
  for (let day = 0; day < days; day += 1) {
    const taskDate = addDays(startDate, day);
    // 钱任务只落在周末（每周最多 2 条，符合 PRD「每周 1~2 个」）
    const sides: TaskSide[] = isWeekendDate(taskDate) ? [...MUST_SIDES, 'money'] : [...MUST_SIDES];
    for (const side of sides) {
      const deck = decks.get(side) as Deck;
      // 钱任务池为空只跳过可选任务，不能连带必做任务一起失败
      if (deck.templates.length === 0) continue;
      const { template, rotation } = draw(deck);
      const text = rotationTitle(String(template.text ?? ''), rotation);
      const moneyKind = side === 'money'
        ? (String(template.money_kind ?? '') || deriveMoneyKind(side, text))
        : '';
      planned.push({
        day_index: day,
        task_date: taskDate,
        week_start: weekStartOf(taskDate),
        side,
        seq: SIDE_SEQ[side],
        text,
        proof_kind: String(template.proof_kind ?? 'photo'),
        time_slot: String(template.time_slot ?? 'any'),
        min_budget_cents: side === 'money' ? Number(template.min_budget_cents ?? 0) : 0,
        tags: tagsOf(template, wishType, side, text, moneyKind),
        money_kind: moneyKind,
        template_id: rotation === 0 ? String(template.id) : null,
        rotation,
        is_must: side !== 'money',
        is_for_self: side === 'for_self',
      });
    }
  }
  return planned;
}

/**
 * 落库：id 由 (愿签, 天, 序) 派生 ⇒ 重放时同一批 id，insertIfAbsent 只补缺的那几条。
 * 返回本次真正新插入的行数（0 表示任务已齐全，属于重复签署/崩溃修复）。
 */
export async function insertPlannedTasks(db: DbClient, wish: DbRow, planned: PlannedTask[], now: Date): Promise<number> {
  if (planned.length === 0) return 0;
  const timestamp = now.toISOString();
  const wishId = String(wish.id ?? '');
  const values: Record<string, unknown>[] = [];
  for (const item of planned) {
    values.push({
      id: await derivedUuid(`yuan-ta-task-v1:${wishId}:${item.day_index}:${item.seq}`),
      wish_id: wishId,
      user_id: String(wish.user_id ?? ''),
      day_index: item.day_index,
      task_date: item.task_date,
      week_start: item.week_start,
      side: item.side,
      seq: item.seq,
      text: item.text,
      proof_kind: item.proof_kind,
      time_slot: item.time_slot,
      min_budget_cents: item.min_budget_cents,
      tags: item.tags,
      money_kind: item.money_kind,
      template_id: item.template_id,
      rotation: item.rotation,
      is_must: item.is_must,
      is_for_self: item.is_for_self,
      status: 'pending',
      done_at: null,
      missed_at: null,
      made_up_at: null,
      revoked_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  const written = await write(
    db.from('tasks').insertIfAbsent(values, { onConflict: 'id' }).select('id'),
    'insert planned tasks',
  );
  return written.length;
}

/** 读回整份任务表：day_index 升序、同日按 seq（为 TA → 为自己 → 钱任务） */
export async function listTasks(db: DbClient, wishId: string): Promise<TaskRow[]> {
  const found = await rowsAs<TaskRow>(
    db.from('tasks').select('*').eq('wish_id', wishId).order('day_index').limit(TASKS_PER_WISH_LIMIT),
    'read tasks',
  );
  // 次级排序在代码里做：本地内存库只支持单列 order，线上也不该依赖返回顺序
  return found.sort((a, b) => {
    const day = Number(a.day_index ?? 0) - Number(b.day_index ?? 0);
    if (day !== 0) return day;
    const seq = Number(a.seq ?? 0) - Number(b.seq ?? 0);
    if (seq !== 0) return seq;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
}

export async function findTask(db: DbClient, taskId: string): Promise<TaskRow | null> {
  return firstAs<TaskRow>(db.from('tasks').select('*').eq('id', taskId), 'read task');
}

/**
 * 惰性日界处理（无定时任务）：把该愿签内早于今天的 pending 任务标成 missed。
 * 条件更新天然幂等；affected 返回本次真正翻转的条数，接上 version +1 用。
 */
export async function sweepMissedTasks(db: DbClient, wishId: string, today: string, now: Date): Promise<number> {
  const timestamp = now.toISOString();
  return affected(
    db.from('tasks').update({ status: 'missed', missed_at: timestamp, updated_at: timestamp })
      .eq('wish_id', wishId).eq('status', 'pending').lt('task_date', today),
    'sweep missed tasks',
  );
}

/** 当天任务：一天最多 3 条，按 seq（为 TA → 为自己 → 钱任务）排序 */
export async function listTasksByDate(db: DbClient, wishId: string, date: string): Promise<TaskRow[]> {
  const found = await rowsAs<TaskRow>(
    db.from('tasks').select('*').eq('wish_id', wishId).eq('task_date', date).limit(10),
    'read tasks by date',
  );
  return found.sort((a, b) => {
    const seq = Number(a.seq ?? 0) - Number(b.seq ?? 0);
    if (seq !== 0) return seq;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
}

export function summarizeTasks(tasks: TaskRow[], days: number): Record<string, unknown> {
  const countOf = (side: TaskSide) => tasks.filter((task) => task.side === side).length;
  return {
    days,
    total: tasks.length,
    must: tasks.filter((task) => task.is_must === true).length,
    optional: tasks.filter((task) => task.is_must !== true).length,
    ta: countOf('for_ta'),
    self: countOf('for_self'),
    money: countOf('money'),
  };
}

function parseStoredTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0).slice(0, 3);
  }
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0).slice(0, 3);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** 接口词表（type/title）与库内词表（side/text）的唯一投影点，禁止把整行任务转 JSON 外发 */
export function toTaskDto(task: TaskRow): Record<string, unknown> {
  const side = String(task.side ?? 'for_ta') as TaskSide;
  const text = String(task.text ?? '');
  const moneyKind = side === 'money'
    ? (String(task.money_kind ?? '') || deriveMoneyKind(side, text))
    : '';
  const tags = parseStoredTags(task.tags);
  return {
    id: task.id,
    day_index: Number(task.day_index ?? 0),
    task_date: task.task_date,
    type: SIDE_TO_TYPE[side] ?? 'ta',
    title: text,
    status: task.status,
    is_must: task.is_must === true,
    is_optional: task.is_must !== true,
    seq: Number(task.seq ?? 0),
    proof_kind: task.proof_kind,
    time_slot: task.time_slot,
    min_budget_cents: Number(task.min_budget_cents ?? 0),
    tags: tags.length > 0 ? tags : deriveTaskTags({ wishType: '', side, text, moneyKind }),
    money_kind: moneyKind,
    rotation: Number(task.rotation ?? 0),
  };
}