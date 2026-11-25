/**
 * 服务端 DTO → 页面视图模型（AppData）的唯一映射层。
 *
 * 页面只认 AppData，不直接触碰接口字段；服务端字段改名时只需要改这里。
 * 原则：
 * - 金额在接口里是整数分，页面展示元；这里统一向下取整，不做浮点运算；
 * - 五问答案服务端不回显，映射后 answers 恒为空；草稿仍保存在本机；
 * - 打卡照片需要 600 秒签名 URL，每次加载重新签发，不缓存到本地存储。
 */
import {
  getFileUrl,
  getLedger,
  getSettlement,
  getTodayTasks,
  getWish,
  listTasks,
  listWishes,
  me,
  type CheckinDto,
  type LedgerEntryDto,
  type LedgerViewDto,
  type TaskDto,
  type WishDto,
} from './api';
import type {
  AppData,
  Checkin,
  LedgerEntry,
  SettlementView,
  Task,
  TaskStatus,
  Wish,
} from './domain';

const TYPE_TO_CATEGORY: Record<string, string> = {
  body: '身体',
  sleep: '睡眠',
  lonely: '孤单',
  study: '学业',
  emotion: '情绪',
  life: '生活',
};

export const CATEGORY_TO_TYPE: Record<string, string> = {
  身体: 'body',
  睡眠: 'sleep',
  孤单: 'lonely',
  学业: 'study',
  情绪: 'emotion',
  生活: 'life',
};

export const categoryLabel = (type: string) => TYPE_TO_CATEGORY[type] ?? '生活';

export type RemoteSnapshot = {
  wish: Wish | null;
  checkins: Checkin[];
  ledger: LedgerEntry[];
  ledgerTotals?: AppData['ledgerTotals'];
  wishStatus?: string;
  settleOpenAt?: string;
  settlement?: SettlementView;
  makeupAvailable: boolean;
  currentUser?: AppData['currentUser'];
};

export function mapTask(task: TaskDto): Task {
  return {
    id: task.id,
    date: task.task_date,
    kind: task.type,
    title: task.title,
    status: task.status,
    dayIndex: task.day_index,
    tags: task.tags ?? [],
    moneyKind: task.money_kind === 'save' || task.money_kind === 'earn' ? task.money_kind : undefined,
    amountCents: task.checkin?.amount_cents ?? undefined,
  };
}

export function mapWish(wish: WishDto, tasks: TaskDto[]): Wish {
  return {
    id: wish.id,
    relation: wish.relation,
    name: wish.nickname,
    pronoun: wish.pronoun === 'she' ? '她' : wish.pronoun === 'he' ? '他' : 'TA',
    text: wish.wish_text,
    category: categoryLabel(wish.wish_type),
    answers: ['', '', '', '', ''],
    start: wish.start_date,
    status: wish.status === 'settled' ? 'settled' : 'active',
    ai: false,
    tasks: tasks.map(mapTask),
    days: wish.days,
    endDate: wish.end_date,
    wishType: wish.wish_type,
  };
}

export function mapCheckin(c: CheckinDto, image: string): Checkin {
  return {
    taskId: c.task_id,
    image,
    note: c.note,
    at: c.server_ts,
    proofId: c.proof_id ?? undefined,
    isMakeup: c.is_makeup,
    amountCents: c.amount_cents ?? undefined,
    amountKind: c.amount_kind === 'saved' || c.amount_kind === 'earned' ? c.amount_kind : undefined,
  };
}

export function mapLedger(view: LedgerViewDto | null): {
  ledger: LedgerEntry[];
  ledgerTotals?: AppData['ledgerTotals'];
} {
  if (!view) return { ledger: [] };
  const ledger: LedgerEntry[] = [];
  for (const week of view.weeks) {
    ledger.push({
      id: `budget-${week.week_start}`,
      week: week.week_start,
      kind: 'budget',
      amount: Math.floor(week.budget_cents / 100),
      note: '本周预算',
    });
  }
  for (const entry of view.entries ?? []) {
    ledger.push(mapLedgerEntry(entry));
  }
  return {
    ledger,
    ledgerTotals: {
      saved: Math.floor(view.totals.saved_cents / 100),
      earned: Math.floor(view.totals.income_cents / 100),
      total: Math.floor(view.totals.realized_cents / 100),
    },
  };
}

export function mapLedgerEntry(entry: LedgerEntryDto): LedgerEntry {
  return {
    id: entry.id,
    week: entry.week_start,
    kind: entry.type === 'expense' ? 'expense' : entry.type === 'saved' ? 'saved' : 'income',
    amount: Math.floor(entry.amount_cents / 100),
    note: entry.note || (entry.type === 'expense' ? '非必要支出' : entry.type === 'saved' ? '任务省下' : '兼职收入'),
    taskId: entry.task_id ?? undefined,
  };
}

/** 加载当前账号的最新愿签；草稿不算「已有愿签」，避免未完成的草稿堵住创建入口。 */
export async function loadRemoteSnapshot(token: string): Promise<RemoteSnapshot> {
  const [wishList, meResult] = await Promise.all([
    listWishes(token, 20),
    me(token).catch(() => null),
  ]);
  const summary =
    wishList.items.find((item) => item.status === 'active' || item.status === 'settling') ??
    wishList.items.find((item) => item.status !== 'draft' && item.status !== 'archived');
  const base: RemoteSnapshot = {
    wish: null,
    checkins: [],
    ledger: [],
    makeupAvailable: false,
    currentUser: meResult
      ? { id: meResult.user.id, nickname: meResult.user.nickname, isDemo: meResult.user.is_demo }
      : undefined,
  };
  if (!summary) return base;

  const { wish } = await getWish(token, summary.id);
  const tasksResult = await listTasks(token, summary.id).catch(() => ({ tasks: [] as TaskDto[] }));
  const tasks = tasksResult.tasks;

  const checkinList = tasks
    .map((task) => task.checkin)
    .filter((checkin): checkin is CheckinDto => Boolean(checkin));
  const images = await Promise.all(
    checkinList.map(async (checkin) => {
      if (!checkin.proof_id) return '';
      try {
        return (await getFileUrl(token, checkin.proof_id)).url;
      } catch {
        return '';
      }
    }),
  );
  const checkins = checkinList.map((checkin, index) => mapCheckin(checkin, images[index] ?? ''));

  let ledger: LedgerEntry[] = [];
  let ledgerTotals: AppData['ledgerTotals'];
  if (wish.status === 'active' || wish.status === 'settling') {
    try {
      const view = await getLedger(token, wish.id);
      const mapped = mapLedger(view);
      ledger = mapped.ledger;
      ledgerTotals = mapped.ledgerTotals;
    } catch {
      // 契约日期异常或账号没有账本时保持空账本，不阻塞其他页面
    }
  }

  let settlement: SettlementView | undefined;
  if (wish.status === 'settled') {
    try {
      settlement = await getSettlement(token, wish.id);
    } catch {
      settlement = undefined;
    }
  }

  let makeupAvailable = false;
  if (wish.status === 'active') {
    try {
      const today = await getTodayTasks(token, wish.id);
      makeupAvailable = today.makeup_ticket?.status === 'available';
    } catch {
      makeupAvailable = false;
    }
  }

  return {
    wish: mapWish(wish, tasks),
    checkins,
    ledger,
    ledgerTotals,
    wishStatus: wish.status,
    settleOpenAt: wish.settle_open_at || '',
    settlement,
    makeupAvailable,
    currentUser: base.currentUser,
  };
}

export function taskStatusLabel(status?: TaskStatus): string {
  if (status === 'done') return '已完成';
  if (status === 'made_up') return '已补卡';
  if (status === 'missed') return '已错过';
  return '待完成';
}
