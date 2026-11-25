/**
 * 确定性规则与共享词表：愿望分类、关系组、任务档位、可重放的随机数。
 *
 * 为什么单独一层：这些字面量同时被「运行时引擎」和「种子内容表」引用，
 * 放在 domain 里才能保证 Function 打包后仍可用（Function 不能 import tools/ 下的文件），
 * 也避免 PRD 的六类/十二关系在代码与 seed 里各写一份而漂移。
 * 本文件不碰数据库、不碰 Web Crypto，纯函数 ⇒ Node 与 Deno 都能直接跑。
 */

/** PRD 5.2 的六类愿望，数组顺序即同分时的优先级 */
export type WishType = 'body' | 'sleep' | 'lonely' | 'study' | 'emotion' | 'life';
export const WISH_TYPES: readonly WishType[] = ['body', 'sleep', 'lonely', 'study', 'emotion', 'life'];

/** PRD 4.2 B-02 的 12 种关系，顺序即前端分组展示顺序 */
export const RELATIONS = [
  '妈妈', '爸爸', '奶奶', '爷爷', '姥姥', '姥爷',
  '室友', '闺蜜', '兄弟', '恋人', '老师', '一个陌生人',
] as const;
export type Relation = (typeof RELATIONS)[number];

/** PRD 5.1 关系组：语气决定模板文案，任务倾向决定候选池排序偏好 */
export type RelationGroup = 'parent' | 'peer' | 'intimate' | 'mentor' | 'stranger';
export const RELATION_GROUPS: Record<Relation, { group: RelationGroup; tone: string; taskTendency: WishType[] }> = {
  妈妈: { group: 'parent', tone: '亲近、克制、具体', taskTendency: ['body', 'sleep', 'lonely'] },
  爸爸: { group: 'parent', tone: '亲近、克制、具体', taskTendency: ['body', 'sleep', 'lonely'] },
  奶奶: { group: 'parent', tone: '亲近、克制、具体', taskTendency: ['body', 'sleep', 'lonely'] },
  爷爷: { group: 'parent', tone: '亲近、克制、具体', taskTendency: ['body', 'sleep', 'lonely'] },
  姥姥: { group: 'parent', tone: '亲近、克制、具体', taskTendency: ['body', 'sleep', 'lonely'] },
  姥爷: { group: 'parent', tone: '亲近、克制、具体', taskTendency: ['body', 'sleep', 'lonely'] },
  室友: { group: 'peer', tone: '直接、可开玩笑', taskTendency: ['study', 'emotion', 'life'] },
  闺蜜: { group: 'peer', tone: '直接、可开玩笑', taskTendency: ['study', 'emotion', 'life'] },
  兄弟: { group: 'peer', tone: '直接、可开玩笑', taskTendency: ['study', 'emotion', 'life'] },
  恋人: { group: 'intimate', tone: '亲密但不过度', taskTendency: ['emotion', 'lonely'] },
  // PRD 5.1 写的「学业、感谢」里「感谢」不是六类之一，落到情绪类（回信与致谢都在这一类）
  老师: { group: 'mentor', tone: '礼貌、有分寸', taskTendency: ['study', 'emotion'] },
  一个陌生人: { group: 'stranger', tone: '克制、不冒犯', taskTendency: ['life', 'emotion'] },
};

export function relationGroupOf(relation: string): RelationGroup | '' {
  return RELATION_GROUPS[relation as Relation]?.group ?? '';
}

/** PRD 5.4 的四个礼物类别 */
export type GiftCategory = 'health' | 'company' | 'life' | 'heart';

/** 代词（PRD B-05）：默认 TA，用户可改 */
export const PRONOUNS = ['she', 'he', 'they'] as const;
export type Pronoun = (typeof PRONOUNS)[number];

/**
 * 契约天数：产品默认且前端固定十天。
 * 7/14/30 仅保留给旧客户端与内部回归测试，产品界面不再提供选择。
 */
export const CONTRACT_DAYS = [7, 10, 14, 30] as const;
export const DEFAULT_CONTRACT_DAYS = 10;
/** 续期由用户在结算页自选 1~5 天 */
export const MIN_EXTEND_DAYS = 1;
export const MAX_EXTEND_DAYS = 5;
export const EXTEND_DAY_OPTIONS = [1, 2, 3, 4, 5] as const;
export type ExtendDays = (typeof EXTEND_DAY_OPTIONS)[number];

/** 库内档位（tasks.side / task_templates.side）与接口档位（type）的映射，只在这里定义一次 */
export type TaskSide = 'for_ta' | 'for_self' | 'money';
export type TaskType = 'ta' | 'self' | 'money';
export const SIDE_TO_TYPE: Record<TaskSide, TaskType> = { for_ta: 'ta', for_self: 'self', money: 'money' };
/** 同日展示顺序：为 TA 在前，其次为自己，钱任务最后 */
export const SIDE_SEQ: Record<TaskSide, number> = { for_ta: 1, for_self: 2, money: 3 };
/** 每天必做两条（1 为 TA + 1 为自己），钱任务只在周末追加且可选 */
export const MUST_SIDES: readonly TaskSide[] = ['for_ta', 'for_self'];

/**
 * 任务标签词表：每个 2~3 字，一条任务可带 1~3 个。
 * 标签不拼进任务文案，避免破坏 tasks 的 UNIQUE(wish_id, text)。
 */
export const TASK_TAGS = [
  '陪伴', '沟通', '心意', '健康', '自理', '生活', '省钱', '赚钱', '记录', '行动', '学业', '情绪',
] as const;
export type TaskTag = (typeof TASK_TAGS)[number];

/** 金钱任务的两种口径：省钱 / 赚钱 */
export type MoneyKind = 'save' | 'earn';
export const MONEY_KINDS: readonly MoneyKind[] = ['save', 'earn'];

/** 旧数据/旧模板没有 money_kind 时，按文案关键词确定性推断 */
export function deriveMoneyKind(side: string, text: string): MoneyKind | '' {
  if (side !== 'money') return '';
  return /兼职|答疑|转卖|收入|挣|工资|代课|接单/.test(text) ? 'earn' : 'save';
}

const CATEGORY_TAG: Record<string, TaskTag> = {
  body: '健康',
  sleep: '健康',
  lonely: '陪伴',
  study: '学业',
  emotion: '情绪',
  life: '生活',
};

/**
 * 任务标签的确定性派生：种子导入与旧任务兜底共用同一套规则。
 * 优先级：基础标签（心意/自理/省钱/赚钱）→ 行为标签（沟通/陪伴/行动/记录）→ 愿望类型标签。
 */
export function deriveTaskTags(input: {
  wishType: string;
  side: string;
  text: string;
  moneyKind?: string;
}): TaskTag[] {
  const tags: TaskTag[] = [];
  const add = (tag: TaskTag) => {
    if (!tags.includes(tag) && tags.length < 3) tags.push(tag);
  };
  const category = CATEGORY_TAG[input.wishType];

  if (input.side === 'money') {
    const kind = (input.moneyKind ?? deriveMoneyKind(input.side, input.text)) || 'save';
    add(kind === 'earn' ? '赚钱' : '省钱');
    add(/外卖|奶茶|做饭|买|资料|账单/.test(input.text) ? '生活' : '行动');
    return tags;
  }

  if (input.side === 'for_self') {
    add('自理');
    if (category) add(category);
    if (/写|记|拍|截图|记录|清单/.test(input.text)) add('记录');
    else if (/走|出门|散步|运动|拉伸|收拾|整理/.test(input.text)) add('行动');
    return tags;
  }

  add('心意');
  if (/电话|视频|聊天|消息|发|问|说|语音|通话|回复|夸/.test(input.text)) add('沟通');
  if (/陪|回家|吃饭|一起|散步|走|坐|见面/.test(input.text)) add('陪伴');
  if (/买|寄|带|查|修|做|跑|排|整理|订|教/.test(input.text)) add('行动');
  if (category) add(category);
  return tags;
}

/**
 * PRD 5.2 的关键词表：命中最多的一类获胜，同分按 WISH_TYPES 顺序，无命中归「生活」。
 * 纯字符串包含判定，不调用 AI，也不做分词 ⇒ 同一输入永远同一结果。
 */
const CLASSIFIER_KEYWORDS: Record<WishType, readonly string[]> = {
  body: ['疼', '腿', '腰', '血压', '体检', '吃药'],
  sleep: ['熬夜', '失眠', '睡不好', '手机'],
  lonely: ['一个人', '没人说话', '冷清'],
  study: ['考试', '论文', '考研', '压力'],
  emotion: ['难过', '焦虑', '烦', '崩溃'],
  life: ['做饭', '收拾', '通勤', '琐事'],
};

export interface Classification {
  wishType: WishType;
  /** 置信度用基点整数（0~10000）：平台不支持 numeric，且分类只用于选池不需要浮点 */
  confidenceBps: number;
}

export function classifyWish(rawInput: string): Classification {
  const text = rawInput.toLowerCase();
  const hits = WISH_TYPES.map((type) => ({
    type,
    count: CLASSIFIER_KEYWORDS[type].filter((word) => text.includes(word)).length,
  }));
  const total = hits.reduce((sum, item) => sum + item.count, 0);
  // reduce 取首个最大值 ⇒ 同分自动落在 WISH_TYPES 里靠前的那一类
  const winner = hits.reduce((best, item) => (item.count > best.count ? item : best), hits[0]);
  if (winner.count === 0) return { wishType: 'life', confidenceBps: 0 };
  return {
    wishType: winner.type,
    confidenceBps: Math.min(10000, Math.round((winner.count / total) * 10000)),
  };
}

/** 展示标题：确定性清洗 + 截断，≤30 字（docs/02 §9）；原文另存 raw_input 供回显 */
export function deriveTitle(rawInput: string): string {
  const cleaned = rawInput.replace(/\s+/g, ' ').trim().replace(/[。．.！!？?，,；;、\s]+$/g, '');
  const limit = 30;
  if (cleaned.length === 0) return '替 TA 许个愿';
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1)}…`;
}

/**
 * mulberry32：32 位种子 → 确定性 [0,1) 序列。
 * 任务抽取禁止 Math.random：签署可能重放（幂等重试、崩溃后补齐），重放必须得到同一批任务。
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates，随机源由调用方注入（便于用同一序列重放） */
export function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 轮转副本的标题后缀：候选池耗尽时靠它保证「同一愿签内标题不重复」 */
export function rotationTitle(text: string, rotation: number): string {
  return rotation === 0 ? text : `${text}（第${rotation + 1}轮）`;
}