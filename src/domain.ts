export type TaskKind = 'ta' | 'self' | 'money';
export type TaskStatus = 'pending' | 'done' | 'missed' | 'made_up';
export type Task = {
  id: string;
  date: string;
  kind: TaskKind;
  title: string;
  status?: TaskStatus;
  dayIndex?: number;
  /** 任务标签（1~3 个，2~3 字） */
  tags: string[];
  /** 钱任务口径：save / earn */
  moneyKind?: 'save' | 'earn';
  /** 打卡时填写的实际金额（分） */
  amountCents?: number;
};
export type Wish = {
  id: string;
  relation: string;
  name: string;
  pronoun: string;
  text: string;
  category: string;
  answers: string[];
  start: string;
  status: 'active' | 'settled';
  ai: boolean;
  tasks: Task[];
  signature?: string;
  extended?: boolean;
  days?: number;
  endDate?: string;
  wishType?: string;
};
export type Checkin = {
  taskId: string;
  image: string;
  note: string;
  at: string;
  proofId?: string;
  isMakeup?: boolean;
  amountCents?: number;
  amountKind?: 'saved' | 'earned';
};

export type SettlementOutcome = 'double_realized' | 'cyber_only' | 'unrealized';
export type EasterEggView = {
  title: string;
  direction: 'visit' | 'company' | 'health' | 'heart' | 'life';
  summary: string;
  plan_steps: string[];
  cost_min_cents: number;
  cost_max_cents: number;
  realized_cents: number;
  affordable: boolean;
  gap_cents: number;
  closing: string;
  ai_label: string;
  source: 'agent' | 'template';
  model: string;
};
export type SettlementView = {
  wish_id: string;
  settlement_version: number;
  status: string;
  first_act: {
    outcome: SettlementOutcome;
    outcome_label: string;
    stamped: boolean;
    settled_at: string;
    progress_ratio_bps: number;
    tasks: {
      must_total: number;
      must_done: number;
      money_total: number;
      money_done: number;
      checkin_count: number;
      makeup_count: number;
      must_bps: number;
      money_bps: number;
      total: number;
      done: number;
    };
    task_details: Array<{
      id: string;
      day_index: number;
      task_date: string;
      type: TaskKind;
      title: string;
      status: TaskStatus;
      is_must: boolean;
    }>;
  };
  second_act: {
    realized_cents: number;
    realized_yuan: number;
    saved_cents: number;
    earned_cents: number;
    gift: {
      id: string;
      category: string;
      title: string;
      note: string;
      min_cents: number;
      max_cents: number;
      min_yuan: number;
      max_yuan: number;
      price_median_cents: number;
      price_median_yuan: number;
    } | null;
    gap_cents: number;
    gap_yuan: number;
    gap_band: 'exact' | 'near' | 'far';
    gap_band_label: string;
    copy_text: string;
    letter_text: string;
    easter_egg?: EasterEggView | null;
  };
  extension: {
    can_extend: boolean;
    renew_count: number;
    allowed_days: number[];
    min_days: number;
    max_days: number;
    reason: string;
  };
};
export type LedgerEntry = {
  id: string;
  week: string;
  kind: 'budget' | 'expense' | 'income' | 'saved';
  amount: number;
  note: string;
  taskId?: string;
};
export type Draft = {
  step: number;
  question: number;
  relation: string;
  name: string;
  pronoun: string;
  text: string;
  answers: string[];
  ai: boolean;
  /** 动态问卷的分支选择：每题选中的选项 id（可空） */
  choices: string[];
  /** 动态问卷的粗粒度档位，签契约时随答案一起提交 */
  meta: {
    giftCategory?: string;
    aloneLevel?: string;
    lastHome?: string;
    travelBand?: string;
    costBand?: string;
    disposableBand?: string;
  };
};
export type AppData = {
  version: 1;
  wish: Wish | null;
  draft: Draft;
  checkins: Checkin[];
  ledger: LedgerEntry[];
  replies: Record<string, string[]>;
  letter: string;
  celebration: boolean;
  /** 服务端返回的愿签状态；wish.status 是页面使用的二值投影 */
  wishStatus?: string;
  settleOpenAt?: string;
  settlement?: SettlementView;
  /** 服务端汇总，避免前端重复推算「已计入周」的口径 */
  ledgerTotals?: { saved: number; earned: number; total: number };
  currentUser?: { id: string; nickname: string; isDemo?: boolean };
  recoveryCode?: string;
  makeupAvailable?: boolean;
};
export const relations = [
  '妈妈',
  '爸爸',
  '奶奶',
  '爷爷',
  '姥姥',
  '姥爷',
  '室友',
  '闺蜜',
  '兄弟',
  '恋人',
  '老师',
  '一个陌生人',
];
export const questions = [
  '最近，TA最让你挂念的是什么？',
  'TA平时会不会觉得孤单？',
  '上一次好好聊天，是什么时候？',
  '你每周可以自由安排的零花钱大约有多少？',
  '如果能为TA做一件小事，你想做什么？',
];
export const emptyDraft = (): Draft => ({
  step: 0,
  question: 0,
  relation: '妈妈',
  name: '妈妈',
  pronoun: '她',
  text: '',
  answers: ['', '', '', '', ''],
  ai: false,
  choices: ['', '', '', '', ''],
  meta: {},
});
export const emptyData = (): AppData => ({
  version: 1,
  wish: null,
  draft: emptyDraft(),
  checkins: [],
  ledger: [],
  replies: {},
  letter: '',
  celebration: false,
});
// UTC+8 minus the 04:00 boundary equals UTC+4. Avoid host timezone dependence.
export function productDay(now = new Date()) {
  return new Date(now.getTime() + 4 * 3600000).toISOString().slice(0, 10);
}
export function addDays(day: string, n: number) {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function weekStart(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}
export function category(text: string) {
  const groups = [
    ['身体', /疼|腿|腰|血压|体检|吃药/g],
    ['睡眠', /熬夜|失眠|睡|手机/g],
    ['孤单', /一个人|没人说话|冷清|孤单/g],
    ['学业', /考试|论文|考研|学习/g],
    ['情绪', /难过|焦虑|烦|崩溃/g],
  ] as const;
  let best = '生活',
    score = 0;
  for (const [name, re] of groups) {
    const n = (text.match(re) || []).length;
    if (n > score) {
      score = n;
      best = name;
    }
  }
  return best;
}
/** 前端本地示例/兜底用的标签派生，和后端词表保持同一套 2~3 字标签 */
function localTags(kind: TaskKind, text: string): string[] {
  if (kind === 'money') return ['省钱', '生活'];
  if (kind === 'self') {
    const tags = ['自理'];
    if (/写|记|拍|截图|记录|清单/.test(text)) tags.push('记录');
    else if (/走|出门|散步|运动|拉伸|收拾|整理/.test(text)) tags.push('行动');
    return tags;
  }
  const tags = ['心意'];
  if (/电话|视频|聊天|消息|发|问|说|语音|通话/.test(text)) tags.push('沟通');
  if (/陪|回家|吃饭|一起|散步|见面/.test(text)) tags.push('陪伴');
  if (tags.length < 3) tags.push('生活');
  return tags;
}

export function createWish(draft: Draft, now = new Date()): Wish {
  if (
    !draft.name.trim() ||
    draft.name.trim().length > 8 ||
    ['自己', '我', '本人'].includes(draft.name.trim())
  )
    throw new Error('请替一个具体的人许愿，称呼最多8字。');
  if (!draft.text.trim() || draft.text.length > 120) throw new Error('愿望需要1至120字。');
  const start = productDay(now),
    id = crypto.randomUUID();
  const forTA = [
    '给{TA}打个电话，问问今天过得怎么样',
    '把今天的一张照片发给{TA}，配上一句话',
    '认真听{TA}讲一件最近的小事',
    '给{TA}发一句具体的感谢',
    '和{TA}约一次有空的聊天',
    '问问{TA}最近有没有好好吃饭',
    '给{TA}写一段不催促的关心',
  ];
  const self = [
    '今晚早点放下手机，给自己留一点休息时间',
    '好好吃一顿饭，拍下今天的餐盘',
    '出门散步十分钟，看看路边的树',
    '收拾书桌的一角，留出一块空白',
    '喝一杯温水，给忙碌按下暂停',
    '睡前读两页喜欢的书',
    '写下今天一件值得开心的小事',
  ];
  const tasks: Task[] = [];
  for (let i = 0; i < 10; i++) {
    const date = addDays(start, i);
    const taTitle = forTA[i % forTA.length].replace('{TA}', draft.name.trim());
    const selfTitle = self[i % self.length];
    tasks.push(
      { id: `${id}-${i}-ta`, date, kind: 'ta', title: taTitle, tags: localTags('ta', taTitle) },
      { id: `${id}-${i}-self`, date, kind: 'self', title: selfTitle, tags: localTags('self', selfTitle) },
    );
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6)
      tasks.push({
        id: `${id}-${i}-money`,
        date,
        kind: 'money',
        title: '做一件力所能及的小兼职，记录一次真实收入',
        tags: ['赚钱', '行动'],
        moneyKind: 'earn',
      });
  }
  return {
    id,
    relation: draft.relation,
    name: draft.name.trim(),
    pronoun: draft.pronoun,
    text: draft.text.trim(),
    ai: draft.ai,
    category: category(draft.text),
    answers: [...draft.answers],
    start,
    status: 'active',
    tasks,
  };
}
export function totals(entries: LedgerEntry[]) {
  // 只有用户确认过的省下金额才计入愿望基金；周预算结余仅作参考，默认 0。
  const saved = entries.filter((e) => e.kind === 'saved').reduce((sum, e) => sum + e.amount, 0);
  const earned = entries.filter((e) => e.kind === 'income').reduce((sum, e) => sum + e.amount, 0);
  return { saved, earned, total: saved + earned };
}
/** 结算是否已开放：优先用服务端 settle_open_at，演示/本机数据回退到本地规则。 */
export function settleDue(data: AppData, now = new Date()) {
  if (data.settlement) return true;
  if (data.settleOpenAt) {
    const openAt = Date.parse(data.settleOpenAt);
    if (!Number.isNaN(openAt)) return now.getTime() >= openAt;
  }
  return settlement(data, now).due;
}

export function settlement(data: AppData, now = new Date()) {
  const w = data.wish;
  if (!w) return { due: false, complete: false, outcome: 'unfinished' as const };
  const due = productDay(now) > w.tasks[w.tasks.length - 1].date;
  const complete = w.tasks
    .filter((t) => t.kind !== 'money')
    .every((t) => data.checkins.some((c) => c.taskId === t.id));
  return {
    due,
    complete,
    outcome: !complete
      ? ('unfinished' as const)
      : totals(data.ledger).total >= 120
        ? ('full' as const)
        : ('cyber' as const),
  };
}
/** 后端演示不可用时的本机兜底：把本地规则结果投影成与接口一致的结算视图。 */
export function localSettlementView(data: AppData, now = new Date()): SettlementView {
  const result = settlement(data, now);
  const tasks = data.wish?.tasks ?? [];
  const done = (t: Task) => data.checkins.some((checkin) => checkin.taskId === t.id);
  const must = tasks.filter((t) => t.kind !== 'money');
  const money = tasks.filter((t) => t.kind === 'money');
  const moneyDone = money.filter(done).length;
  const mustDone = must.filter(done).length;
  const outcome: SettlementOutcome =
    result.outcome === 'full'
      ? 'double_realized'
      : result.outcome === 'cyber'
        ? 'cyber_only'
        : 'unrealized';
  const amounts = totals(data.ledger);
  return {
    wish_id: data.wish?.id ?? 'demo',
    settlement_version: 1,
    status: 'settled',
    first_act: {
      outcome,
      outcome_label:
        outcome === 'double_realized'
          ? '双重兑现'
          : outcome === 'cyber_only'
            ? '赛博实现'
            : '未实现',
      stamped: result.complete,
      settled_at: new Date().toISOString(),
      progress_ratio_bps: tasks.length
        ? Math.round((data.checkins.length / tasks.length) * 10_000)
        : 0,
      tasks: {
        must_total: must.length,
        must_done: mustDone,
        money_total: money.length,
        money_done: moneyDone,
        checkin_count: data.checkins.length,
        makeup_count: 0,
        must_bps: must.length ? Math.round((mustDone / must.length) * 10_000) : 0,
        money_bps: money.length ? Math.round((moneyDone / money.length) * 10_000) : 0,
        total: tasks.length,
        done: mustDone + moneyDone,
      },
      task_details: tasks.map((task, index) => ({
        id: task.id,
        day_index: index,
        task_date: task.date,
        type: task.kind,
        title: task.title,
        status: done(task) ? 'done' : 'missed',
        is_must: task.kind !== 'money',
      })),
    },
    second_act: {
      realized_cents: amounts.total * 100,
      realized_yuan: amounts.total,
      saved_cents: amounts.saved * 100,
      earned_cents: amounts.earned * 100,
      gift: null,
      gap_cents: 0,
      gap_yuan: 0,
      gap_band: 'near',
      gap_band_label: '差一点',
      copy_text: '这份心意已经收好。等下一次见面，再慢慢告诉 TA。',
      letter_text: `亲爱的${data.wish?.name ?? 'TA'}：\n有些关心一直没好好说出口。最近我做了一些小事，也慢慢学着照顾自己。愿你一直被认真惦记着。`,
      easter_egg: null,
    },
    extension: {
      can_extend: outcome !== 'double_realized',
      renew_count: 0,
      allowed_days: [1, 2, 3, 4, 5],
      min_days: 1,
      max_days: 5,
      reason: '',
    },
  };
}

export function demoData(outcome: 'full' | 'cyber' | 'unfinished' = 'full'): AppData {
  const d = emptyData();
  const draft = { ...emptyDraft(), text: '希望妈妈的腿不再疼，每天都能轻轻松松地散步。' };
  d.wish = createWish(draft, new Date(Date.now() - 8 * 86400000));
  d.checkins = d.wish.tasks
    .filter((t) => outcome !== 'unfinished' || t.id !== d.wish!.tasks[0].id)
    .map((t) => ({
      taskId: t.id,
      image: '/assets/postoffice.png',
      note: '今天也把心意变成了一件小事。',
      at: t.date,
    }));
  if (outcome === 'full')
    d.ledger = [
      {
        id: 'demo-budget',
        week: weekStart(d.wish.start),
        kind: 'budget',
        amount: 80,
        note: '本周预算',
      },
      {
        id: 'demo-expense',
        week: weekStart(d.wish.start),
        kind: 'expense',
        amount: 32,
        note: '非必要支出',
      },
      {
        id: 'demo-saved',
        week: weekStart(d.wish.start),
        kind: 'saved',
        amount: 48,
        note: '本周任务省下',
      },
      {
        id: 'demo-income',
        week: weekStart(d.wish.start),
        kind: 'income',
        amount: 120,
        note: '周末线上答疑',
        taskId: d.wish.tasks.find((t) => t.kind === 'money')?.id,
      },
    ];
  return d;
}
