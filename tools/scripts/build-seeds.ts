/**
 * 生成三份 seed JSON：内容来自 database/seed/*.ts，id 与排序完全确定性。
 *
 *   node tools/scripts/build-seeds.ts        # 写 database/seed/*.json
 *   node tools/scripts/build-seeds.ts --check # 只校验不写盘（内容表改坏时先在这里失败）
 *
 * 为什么要有这个脚本：seed 是一次性导入的数据，id 必须稳定（重复执行不产生新行），
 * 且数量本身是 PRD 的验收项（任务 120 条、礼物 24 件、每关系 6 条模板）。
 * 把这两件事写成断言，比人工数一遍可靠。
 *
 * 另一条硬约束：DDL 里 NOT NULL DEFAULT 的列也要显式给值。
 * 线上 Postgres 会补默认值，但本地内存库不补 ⇒ 少写一个 is_active 就会让冒烟抽不到候选池。
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELATIONS,
  RELATION_GROUPS,
  WISH_TYPES,
  deriveMoneyKind,
  deriveTaskTags,
} from '../../backend/domain/rules.ts';
import type { Relation, WishType } from '../../backend/domain/rules.ts';
import { WISH_TEMPLATES } from '../../database/seed/wish-templates.ts';
import { TASK_TEMPLATES } from '../../database/seed/tasks.ts';
import { REWARDS } from '../../database/seed/rewards.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(HERE, '..', '..', 'database', 'seed');

/**
 * 固定命名空间派生 UUID（v4 形态）：同一行内容永远得到同一个 id。
 * 这里不需要 RFC 4122 的严格语义，只需要「稳定 + 符合 UUID_PATTERN」。
 * 与 backend/lib/id.ts#derivedUuid 同一套整形规则，两边不会给出不同形态的 id。
 */
function stableId(kind: string, name: string): string {
  const hex = createHmac('sha256', `yuan-ta-seed-v1:${kind}`).update(name, 'utf8').digest('hex').slice(0, 32);
  const shaped = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(shaped)) {
    throw new Error(`stableId 产出了非法 UUID：${kind}/${name} → ${shaped}`);
  }
  return shaped;
}

interface SeedRow { [column: string]: unknown }

/** 愿望模板：12 关系 × 6 条，sort_order 在关系内从 1 开始（前端「换一批」按此轮播） */
function buildWishTemplates(): SeedRow[] {
  const perRelation = new Map<Relation, number>();
  return WISH_TEMPLATES.map((tpl) => {
    const seq = (perRelation.get(tpl.relation) ?? 0) + 1;
    perRelation.set(tpl.relation, seq);
    return {
      id: stableId('wish_template', `${tpl.relation}|${tpl.text}`),
      relation: tpl.relation,
      wish_type: tpl.wishType,
      content: tpl.text, // 列名沿用 PRD 6.1 的 content
      tone: RELATION_GROUPS[tpl.relation].tone, // 语气由关系组派生，不在内容表里重复维护
      batch: 1,
      sort_order: seq,
      is_active: true,
    };
  });
}

/** 任务模板：为 TA / 为自己 / 钱任务三档；通用池 relation = null */
function buildTaskTemplates(): SeedRow[] {
  const perType = new Map<WishType, number>();
  return TASK_TEMPLATES.map((tpl) => {
    const seq = (perType.get(tpl.wishType) ?? 0) + 1;
    perType.set(tpl.wishType, seq);
    return {
      id: stableId('task_template', `${tpl.wishType}|${tpl.side}|${tpl.text}`),
      wish_type: tpl.wishType,
      relation: tpl.relation,
      side: tpl.side,
      text: tpl.text,
      proof_kind: tpl.proof,
      time_slot: tpl.slot,
      // 非钱任务恒为 0：DDL 是 NOT NULL DEFAULT 0，写 null 会在真实导入时被拒
      min_budget_cents: tpl.side === 'money' ? (tpl.minBudgetCents ?? 0) : 0,
      money_kind: tpl.side === 'money' ? (tpl.moneyKind ?? deriveMoneyKind(tpl.side, tpl.text)) : '',
      tags: tpl.tags ?? deriveTaskTags({
        wishType: tpl.wishType,
        side: tpl.side,
        text: tpl.text,
        moneyKind: tpl.moneyKind,
      }),
      weekend_only: tpl.weekendOnly === true,
      sort_order: seq,
      is_active: true,
    };
  });
}

/** 礼物目录：价格区间换算成分；recommend_flags 由 forTypes 推导，供结算匹配过滤 */
function buildRewards(): SeedRow[] {
  const perCategory = new Map<string, number>();
  return REWARDS.map((gift) => {
    const seq = (perCategory.get(gift.category) ?? 0) + 1;
    perCategory.set(gift.category, seq);
    return {
      id: stableId('reward', `${gift.category}|${gift.title}`),
      category: gift.category,
      title: gift.title,
      note: gift.note,
      min_cents: gift.minCents,
      max_cents: gift.maxCents,
      recommend_flags: gift.forTypes ?? [],
      sort_order: seq,
      stock_left: null,
      is_active: true,
      version: 1,
    };
  });
}

/** PRD 验收项 + 会导致生成任务时选不到模板的硬错误，都在这里挡住 */
function assertShape(wishes: SeedRow[], tasks: SeedRow[], rewards: SeedRow[]): string[] {
  const problems: string[] = [];
  if (wishes.length !== RELATIONS.length * 6) problems.push(`愿望模板应为 ${RELATIONS.length * 6} 条，实际 ${wishes.length}`);
  if (tasks.length !== 120) problems.push(`任务模板应为 120 条（PRD 5.3），实际 ${tasks.length}`);
  if (rewards.length !== 24) problems.push(`礼物应为 24 件（PRD 5.4），实际 ${rewards.length}`);

  for (const type of WISH_TYPES) {
    const ofType = tasks.filter((t) => t.wish_type === type);
    if (ofType.length < 12) problems.push(`类型 ${type} 的任务少于 12 条，实际 ${ofType.length}`);
    for (const side of ['for_ta', 'for_self', 'money'] as const) {
      if (!ofType.some((t) => t.side === side)) problems.push(`类型 ${type} 缺少 side=${side} 的任务，每日两张会选不出来`);
    }
    if (ofType.filter((t) => t.side === 'money').length > 4) problems.push(`类型 ${type} 的钱任务过多（${ofType.filter((t) => t.side === 'money').length} 条），易超出每周 1~2 个的约束`);
    // 十天契约末尾允许轮转（用户确认重复派任务即可），但前几天必须抽得出不同任务
    const genericTa = ofType.filter((t) => t.side === 'for_ta' && t.relation === null).length;
    const selfCount = ofType.filter((t) => t.side === 'for_self').length;
    if (genericTa < 7) problems.push(`类型 ${type} 的通用「为 TA」只有 ${genericTa} 条，前 7 天就会被追轮转`);
    if (selfCount < 8) problems.push(`类型 ${type} 的「为自己」只有 ${selfCount} 条，前 8 天就会被追轮转`);
  }

  const tagMissing = tasks.filter((t) => !Array.isArray(t.tags) || t.tags.length === 0);
  if (tagMissing.length > 0) problems.push(`${tagMissing.length} 条任务缺标签`);
  const tagBad = tasks.filter((t) => (t.tags as unknown[]).some((tag) => typeof tag !== 'string' || tag.length < 2 || tag.length > 3));
  if (tagBad.length > 0) problems.push(`${tagBad.length} 条任务含非 2~3 字标签`);
  const moneyKindMissing = tasks.filter((t) => t.side === 'money' && !['save', 'earn'].includes(String(t.money_kind)));
  if (moneyKindMissing.length > 0) problems.push(`${moneyKindMissing.length} 条钱任务缺 money_kind（save/earn）`);

  const textTooLong = tasks.filter((t) => String(t.text).length > 60);
  if (textTooLong.length > 0) problems.push(`任务文案超 60 字：${textTooLong.map((t) => String(t.text).slice(0, 12)).join('、')}`);
  const moneyNoFloor = tasks.filter((t) => t.side === 'money' && !(Number(t.min_budget_cents) > 0));
  if (moneyNoFloor.length > 0) problems.push(`${moneyNoFloor.length} 条钱任务缺 min_budget_cents`);
  const moneyNotWeekend = tasks.filter((t) => t.side === 'money' && t.weekend_only !== true);
  if (moneyNotWeekend.length > 0) problems.push(`${moneyNotWeekend.length} 条钱任务未标 weekend_only（PRD：只在周末出现）`);
  // 引擎只按周末追加钱任务，必做两条不区分工作日 ⇒ 必做任务标 weekend_only 会在工作日抽不到
  const mustWeekend = tasks.filter((t) => t.side !== 'money' && t.weekend_only === true);
  if (mustWeekend.length > 0) problems.push(`${mustWeekend.length} 条必做任务标了 weekend_only，引擎不会按它调度`);
  const inactive = [...wishes, ...tasks, ...rewards].filter((row) => row.is_active !== true);
  if (inactive.length > 0) problems.push(`${inactive.length} 行 seed 缺 is_active=true，本地内存库不补默认值`);

  for (const gift of rewards) {
    const min = Number(gift.min_cents), max = Number(gift.max_cents);
    if (!(min > 0 && max >= min)) problems.push(`礼物「${gift.title}」价格区间非法：${min}-${max}`);
    if (max > 50_000) problems.push(`礼物「${gift.title}」上限 ${max / 100} 元，超过 500 元的礼物不在本轮范围`);
  }

  for (const relation of RELATIONS) if (!RELATION_GROUPS[relation]) problems.push(`RELATION_GROUPS 缺少关系「${relation}」`);
  const ids = [...wishes, ...tasks, ...rewards].map((row) => String(row.id));
  if (new Set(ids).size !== ids.length) problems.push('seed id 出现重复，stableId 的命名串不够区分');
  return problems;
}

function render(rows: SeedRow[], table: string, source: string): string {
  const header = {
    table,
    source,
    note: '由 tools/scripts/build-seeds.ts 生成，请勿手改；内容表在 database/seed/*.ts。',
    count: rows.length,
    rows,
  };
  return `${JSON.stringify(header, null, 2)}\n`;
}

/**
 * Function 包只能带 backend/，但启动播种要读同一份 seed。
 * 因此把三份 JSON 的 rows 再落一份自包含 TS 到 backend/data/，内容仍由上面两个生成物决定。
 */
function renderBackendModule(wishes: SeedRow[], tasks: SeedRow[], rewards: SeedRow[]): string {
  const tables = [
    { table: 'wish_templates', expected: wishes.length, rows: wishes },
    { table: 'task_templates', expected: tasks.length, rows: tasks },
    { table: 'rewards', expected: rewards.length, rows: rewards },
  ];
  return `/**
 * 自动生成，勿手改：源数据是 database/seed/*.json（由 tools/scripts/build-seeds.ts 生成）。
 * 本文件属于 Function 包（backend/），供服务端启动时幂等播种使用；
 * 改内容请改 database/seed/*.ts 后重跑生成脚本。
 */
export type SeedRow = Record<string, unknown>;

export interface SeedTable {
  table: 'wish_templates' | 'task_templates' | 'rewards';
  expected: number;
  rows: SeedRow[];
}

export const SEED_TABLES: SeedTable[] = ${JSON.stringify(tables, null, 2)};
`;
}

const wishes = buildWishTemplates();
const tasks = buildTaskTemplates();
const rewards = buildRewards();
const problems = assertShape(wishes, tasks, rewards);
if (problems.length > 0) {
  console.error(`seed 校验未通过（${problems.length} 项）：`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exitCode = 1;
} else {
  console.log(`seed 形状校验通过：wish_templates ${wishes.length}、task_templates ${tasks.length}、rewards ${rewards.length}`);
}

if (process.argv.includes('--check')) {
  // 只做校验：CI 或改完内容表后自查用
} else {
  mkdirSync(SEED_DIR, { recursive: true });
  const files: Array<[string, SeedRow[], string]> = [
    ['wish_templates.json', wishes, 'seed/wish-templates.ts（12 关系 × 6 条）'],
    ['task_templates.json', tasks, 'seed/tasks.ts（6 类型 × 20 条：为 TA 10 + 为自己 8 + 钱任务 2）'],
    ['rewards.json', rewards, 'seed/rewards.ts（24 件，四类）'],
  ];
  for (const [name, rows, source] of files) {
    const target = join(SEED_DIR, name);
    const next = render(rows, name.replace(/\.json$/, ''), source);
    const current = (() => { try { return readFileSync(target, 'utf8'); } catch { return null; } })();
    if (current === next) console.log(`  = ${name}（未变化）`);
    else { writeFileSync(target, next, 'utf8'); console.log(`  ✓ ${name}（${rows.length} 行）`); }
  }

  const backendData = join(HERE, '..', '..', 'backend', 'data');
  mkdirSync(backendData, { recursive: true });
  const moduleTarget = join(backendData, 'seed-rows.ts');
  const moduleNext = renderBackendModule(wishes, tasks, rewards);
  const moduleCurrent = (() => { try { return readFileSync(moduleTarget, 'utf8'); } catch { return null; } })();
  if (moduleCurrent === moduleNext) console.log('  = backend/data/seed-rows.ts（未变化）');
  else { writeFileSync(moduleTarget, moduleNext, 'utf8'); console.log(`  ✓ backend/data/seed-rows.ts（${wishes.length + tasks.length + rewards.length} 行）`); }
}