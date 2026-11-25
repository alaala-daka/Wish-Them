/**
 * 任务模板内容表（PRD 5.3）：6 类愿望 × 20 条 = 120 条。
 *
 * 每类型固定 10 条为 TA + 8 条为自己 + 2 条钱任务：
 * - 为 TA 里含关系专属模板（relation 非 null），只有契约关系匹配时才进候选；
 *   去掉专属后每类型仍有 ≥7 条通用模板，前十天的前几天能抽到不同任务。
 * - 为自己 8 条全是通用模板；十天契约末尾会轮转，按用户确认的口径「重复派任务即可」。
 * - 钱任务 2 条，只在周末追加；十天契约可能遇到 2~4 个周末日，末尾同样允许轮转。
 *   引擎按「（第 N 轮）」后缀保证同一愿签内标题唯一；续期同理，不额外扩容内容表。
 *
 * weekend_only 只标在钱任务上：引擎按「周末追加钱任务」调度，必做两条不区分工作日，
 * 给必做任务标 weekend_only 会让它在工作日抽不到，反而破坏每日两条的硬规则。
 *
 * 词表来自 domain/rules.ts；展开与断言在 tools/scripts/build-seeds.ts。
 */
import type { MoneyKind, Relation, TaskSide, WishType } from '../../backend/domain/rules.ts';

export interface TaskTemplateSeed {
  wishType: WishType;
  /** null = 不限关系（通用池）；非 null = 只在契约关系匹配时进入候选 */
  relation: Relation | null;
  side: TaskSide;
  /** 第二人称祈使句，≤60 字 */
  text: string;
  /** 需要的佐证类型，前端据此选拍摄/截图入口 */
  proof: 'photo' | 'screenshot';
  /** 建议完成时段，仅作展示提示，不做校验 */
  slot: 'morning' | 'daytime' | 'evening' | 'any';
  /** 钱任务的参考金额（分）；真实金额以用户打卡时填写为准 */
  minBudgetCents?: number;
  /** 钱任务口径：省钱 / 赚钱；非钱任务为空 */
  moneyKind?: MoneyKind;
  /** 可选标签覆盖；不写则由规则按侧别与愿望类型确定性派生 */
  tags?: string[];
  weekendOnly?: boolean;
}

export const TASK_TEMPLATES: TaskTemplateSeed[] = [
  // ── 身体：提醒、问候、陪伴就医 ──────────────────────────────────────────
  { wishType: 'body', relation: null, side: 'for_ta', text: '今晚十点给 TA 打电话，问今天走了多少步。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'body', relation: null, side: 'for_ta', text: '提醒 TA 吃今天的药，等 TA 回复后说一句“别省”。', proof: 'screenshot', slot: 'morning' },
  { wishType: 'body', relation: null, side: 'for_ta', text: '陪 TA 视频时，让 TA 把疼的地方指给你看。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'body', relation: null, side: 'for_ta', text: '帮 TA 查离 TA 最近的一次门诊时间，截图发过去。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'body', relation: null, side: 'for_ta', text: '给 TA 寄一小包热敷贴，拍下快递单。', proof: 'photo', slot: 'any' },
  { wishType: 'body', relation: null, side: 'for_ta', text: '和 TA 约一次体检时间，截图聊天记录。', proof: 'screenshot', slot: 'any' },
  { wishType: 'body', relation: null, side: 'for_ta', text: '今天陪 TA 走一段路，拍一张一起走过的路。', proof: 'photo', slot: 'evening' },
  { wishType: 'body', relation: '妈妈', side: 'for_ta', text: '晚十点给妈妈打电话，问她今天走了多少步。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'body', relation: '姥姥', side: 'for_ta', text: '把今天的一张照片发给姥姥，配一句话。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'body', relation: '爷爷', side: 'for_ta', text: '教爷爷一个缓解膝盖疼的动作，拍下爷爷练习的样子。', proof: 'photo', slot: 'daytime' },
  { wishType: 'body', relation: null, side: 'for_self', text: '23:30 前放下手机，拍一张熄灯照。', proof: 'photo', slot: 'evening' },
  { wishType: 'body', relation: null, side: 'for_self', text: '三餐按时，拍一张餐盘。', proof: 'photo', slot: 'daytime' },
  { wishType: 'body', relation: null, side: 'for_self', text: '今天走满 6000 步，截图步数。', proof: 'screenshot', slot: 'any' },
  { wishType: 'body', relation: null, side: 'for_self', text: '给自己倒一杯温水，拍一张杯子。', proof: 'photo', slot: 'any' },
  { wishType: 'body', relation: null, side: 'for_self', text: '坐久了就起来拉伸一次，拍一张窗外的风景。', proof: 'photo', slot: 'daytime' },
  { wishType: 'body', relation: null, side: 'for_self', text: '把常吃的药按星期分好，拍一张分好的格子。', proof: 'photo', slot: 'morning' },
  { wishType: 'body', relation: null, side: 'for_self', text: '今天做一次十分钟拉伸，拍一张垫子或地板。', proof: 'photo', slot: 'evening' },
  { wishType: 'body', relation: null, side: 'for_self', text: '把今天身体的不适写一行，没有就写“无”，拍下来。', proof: 'photo', slot: 'evening' },
  { wishType: 'body', relation: null, side: 'money', text: '本周奶茶不超过两杯，把省下的钱记下来。', proof: 'screenshot', slot: 'any', weekendOnly: true, minBudgetCents: 500, moneyKind: 'save' },
  { wishType: 'body', relation: null, side: 'money', text: '周末陪 TA 去一趟药店，把比价省下的钱记下来。', proof: 'screenshot', slot: 'daytime', weekendOnly: true, minBudgetCents: 1000, moneyKind: 'save' },

  // ── 睡眠：晚安、熄灯、少刷手机 ──────────────────────────────────────────
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '十一点前给 TA 发一句晚安，截图发送记录。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '问 TA 昨天几点睡的，把 TA 说的数字记下来。', proof: 'screenshot', slot: 'morning' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '和 TA 约定今晚同时熄灯，各自拍一张关灯后的房间。', proof: 'photo', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '给 TA 发一段白噪音，说“试试这个”。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '先问问 TA 想不想把床头灯换成暖光。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '陪 TA 打完一通睡前电话，截图通话时长。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '查一下 TA 那个城市的日落时间，发给 TA。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '提醒 TA 睡前别喝浓茶，拍一张你自己的水杯。', proof: 'photo', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '给 TA 发三行字的睡前消息，截图发送记录。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_ta', text: '今晚不追问 TA 为什么不睡，只说“我在”。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '23:30 前放下手机，拍一张熄灯照。', proof: 'photo', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '记录今天的入睡时间，截图备忘录。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '睡前洗一次热水澡，拍一张浴室的暖灯。', proof: 'photo', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '把明早的闹钟定在固定时间，截图时钟。', proof: 'screenshot', slot: 'any' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '十四点后不碰咖啡，拍一张今天喝的东西。', proof: 'photo', slot: 'daytime' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '关灯后做三件与屏幕无关的事，拍一张床头。', proof: 'photo', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '今晚把手机放到够不着的地方充电，拍一张充电的位置。', proof: 'photo', slot: 'evening' },
  { wishType: 'sleep', relation: null, side: 'for_self', text: '午睡不超过三十分钟，截图闹钟。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'sleep', relation: null, side: 'money', text: '帮 TA 挑一副耳塞或眼罩，把比价省下的钱记下来。', proof: 'screenshot', slot: 'daytime', weekendOnly: true, minBudgetCents: 1500, moneyKind: 'save' },
  { wishType: 'sleep', relation: null, side: 'money', text: '本周少点一次夜宵外卖，省下的钱记进账本。', proof: 'screenshot', slot: 'evening', weekendOnly: true, minBudgetCents: 1200, moneyKind: 'save' },

  // ── 孤单：发照片、打电话、回家 ──────────────────────────────────────────
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '给 TA 打一通超过五分钟的电话，截图时长。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '把今天的晚饭拍给 TA，问 TA 吃了什么。', proof: 'photo', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '和 TA 分享一件今天发生的小事，截图对话。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '陪 TA 云看同一部电影，截图播放进度。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '给 TA 发一张你小时候的照片。', proof: 'photo', slot: 'any' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '问 TA 今天有没有和谁说过话，如实记下。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '在 TA 楼下陪 TA 走一圈，拍下路灯。', proof: 'photo', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '把 TA 介绍给你的一个朋友认识，截图群聊。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'lonely', relation: null, side: 'for_ta', text: '给 TA 点一份水果，拍下 TA 收到的样子。', proof: 'photo', slot: 'any' },
  { wishType: 'lonely', relation: '姥姥', side: 'for_ta', text: '回家一趟，和姥姥吃一顿饭，拍一张饭桌。', proof: 'photo', slot: 'daytime' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '今天主动约一个人一起吃饭，拍一张两个人的餐具。', proof: 'photo', slot: 'daytime' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '和自己待三十分钟，不看手机，拍一张窗外的风景。', proof: 'photo', slot: 'any' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '给一个很久没联系的人发一句问候。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '记下一件让你觉得“有人在场”的事，拍一张写下的话。', proof: 'photo', slot: 'any' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '去一个有人的地方自习两小时，拍一张桌面。', proof: 'photo', slot: 'daytime' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '对 TA 说出一次真实的想念。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '给家里打一通电话，只聊十分钟闲事，截图时长。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'lonely', relation: null, side: 'for_self', text: '今天对一个人说一次“谢谢”，具体到那件事。', proof: 'screenshot', slot: 'any' },
  { wishType: 'lonely', relation: null, side: 'money', text: '周末做一次两小时线上答疑，填收入并附收款截图。', proof: 'screenshot', slot: 'daytime', weekendOnly: true, minBudgetCents: 4000, moneyKind: 'earn' },
  { wishType: 'lonely', relation: null, side: 'money', text: '本周自己做饭代替一次外卖，把省下的钱记进账本。', proof: 'photo', slot: 'daytime', weekendOnly: true, minBudgetCents: 2000, moneyKind: 'save' },

  // ── 学业：鼓励、带饭、自习 ──────────────────────────────────────────────
  { wishType: 'study', relation: null, side: 'for_ta', text: '陪 TA 自习一小时，拍一张你们各自的桌面。', proof: 'photo', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '给 TA 带一次饭，拍一张饭盒。', proof: 'photo', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '听 TA 讲一遍今天卡住的那道题，记下 TA 的思路。', proof: 'photo', slot: 'evening' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '帮 TA 查一个院校或岗位的要求，截图发过去。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '提醒 TA 今天该完成的那一章，记下 TA 的回答。', proof: 'screenshot', slot: 'morning' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '把 TA 的进度夸具体一点，截图发给 TA。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '帮 TA 订一个考试或投递的提醒。', proof: 'screenshot', slot: 'morning' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '整理一份 TA 缺的资料清单，发给 TA。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_ta', text: '如果 TA 说累了，就回一句“那就明天”。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'study', relation: '老师', side: 'for_ta', text: '给老师发一条感谢的消息，截图发送记录。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'study', relation: null, side: 'for_self', text: '今天先做最难的那件事，拍一张完成时的屏幕。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_self', text: '把手机放到另一个房间，学习四十分钟，拍一张书桌。', proof: 'photo', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_self', text: '写下今天真正推进的一件事，拍一张纸。', proof: 'photo', slot: 'evening' },
  { wishType: 'study', relation: null, side: 'for_self', text: '按时吃一顿正经饭，拍一张餐盘。', proof: 'photo', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_self', text: '早睡半小时，截图屏幕使用时间。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'study', relation: null, side: 'for_self', text: '起身走十分钟再回来，拍一张楼下的路。', proof: 'photo', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'for_self', text: '把明天要做的三件事写下来，拍一张清单。', proof: 'photo', slot: 'evening' },
  { wishType: 'study', relation: null, side: 'for_self', text: '今天只集中看一次消息，其余时间静音，截图设置。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'study', relation: null, side: 'money', text: '周末把旧的复习资料转卖，填收入并附收款截图。', proof: 'screenshot', slot: 'daytime', weekendOnly: true, minBudgetCents: 2000, moneyKind: 'earn' },
  { wishType: 'study', relation: null, side: 'money', text: '本周不买新的教辅，把省下的钱记进账本。', proof: 'screenshot', slot: 'any', weekendOnly: true, minBudgetCents: 1500, moneyKind: 'save' },

  // ── 情绪：倾听、散步、陪伴 ──────────────────────────────────────────────
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '听 TA 说十分钟，中间不插话，记下一句 TA 说的话。', proof: 'photo', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '陪 TA 走一圈，拍下路的尽头。', proof: 'photo', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '问 TA“要不要我陪着”，不要问“你怎么了”。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '给 TA 发一件今天的小确幸，让 TA 笑一下。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: 'TA 说“没事”时，多发一句“我陪你一会儿”。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '陪 TA 做一件不需要理由的事，拍一张照片。', proof: 'photo', slot: 'any' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '把 TA 说过的话复述一遍，确认自己听懂了。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '把 TA 今天最在意的事记下来，明天先问这件事。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_ta', text: '给 TA 点一杯热的，备注写一句不留名。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'emotion', relation: '恋人', side: 'for_ta', text: '和 TA 把一件拖着没聊的事聊开，记下开始和结束时间。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '写下自己今天的情绪，只写一句。', proof: 'photo', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '今天不评价自己一次，把“我真差”换成一句事实写下来。', proof: 'photo', slot: 'any' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '出去晒十分钟太阳，拍一张天空。', proof: 'photo', slot: 'daytime' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '联系一个能说话的人，截图对话。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '做一件只做五分钟的小事，拍一张结果。', proof: 'photo', slot: 'daytime' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '早点睡，拍一张关灯后的床头。', proof: 'photo', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '今天允许自己休息十分钟，什么都不做，拍一张窗外。', proof: 'photo', slot: 'daytime' },
  { wishType: 'emotion', relation: null, side: 'for_self', text: '把一句一直想说的话写下来，拍一张纸。', proof: 'photo', slot: 'evening' },
  { wishType: 'emotion', relation: null, side: 'money', text: '周末做一次两小时兼职，填收入并附工作截图。', proof: 'screenshot', slot: 'daytime', weekendOnly: true, minBudgetCents: 5000, moneyKind: 'earn' },
  { wishType: 'emotion', relation: null, side: 'money', text: '本周少买一件不必要的小东西，把省下的钱记进账本。', proof: 'screenshot', slot: 'any', weekendOnly: true, minBudgetCents: 1500, moneyKind: 'save' },

  // ── 生活：帮忙查、提醒、代做小事 ────────────────────────────────────────
  { wishType: 'life', relation: null, side: 'for_ta', text: '帮 TA 查一个东西的价格，截图三个来源。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '提醒 TA 交那个费，记下 TA 说“交了”。', proof: 'screenshot', slot: 'morning' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '替 TA 排一次队或跑一次腿，拍一张凭证。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '把 TA 家里坏掉的那个东西的维修方式截图发给 TA。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '陪 TA 一起收拾一个抽屉，拍前后对比。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '给 TA 做一次饭或点一顿靠谱的，拍一张饭菜。', proof: 'photo', slot: 'evening' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '查好 TA 明天要走的路线，截图发给 TA。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '记下 TA 反复抱怨的那件小事，今天替 TA 做掉，拍一张做完的样子。', proof: 'photo', slot: 'any' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '陪 TA 采购一次，拍下购物袋。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_ta', text: '教 TA 用一个能省事的功能，截图操作步骤。', proof: 'screenshot', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_self', text: '把自己的桌面收拾干净，拍前后对比。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_self', text: '今天按时吃三顿饭，拍下其中一顿。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_self', text: '今天不熬夜，截图屏幕使用时间。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'life', relation: null, side: 'for_self', text: '把一件拖了很久的琐事做完，拍一张结果。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_self', text: '给自己买一次水果，拍一张水果。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'for_self', text: '记一笔今天花了多少钱。', proof: 'screenshot', slot: 'evening' },
  { wishType: 'life', relation: null, side: 'for_self', text: '出门前把钥匙、校园卡、耳机清点一遍，拍一张摆好的物品。', proof: 'photo', slot: 'morning' },
  { wishType: 'life', relation: null, side: 'for_self', text: '给自己十分钟，只整理一个角落，拍一张整理好的角落。', proof: 'photo', slot: 'daytime' },
  { wishType: 'life', relation: null, side: 'money', text: '本周奶茶不超过两杯，把省下的钱记下来。', proof: 'screenshot', slot: 'any', weekendOnly: true, minBudgetCents: 1000, moneyKind: 'save' },
  { wishType: 'life', relation: null, side: 'money', text: '周末做两小时线上答疑，填收入并附收款截图。', proof: 'screenshot', slot: 'daytime', weekendOnly: true, minBudgetCents: 4000, moneyKind: 'earn' },
];
