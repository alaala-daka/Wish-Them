/**
 * 动态问卷：五道题，后面几题根据前面的选择走不同分支。
 *
 * 设计原则：
 * - 规则树是预设的，不接 AI：即时、稳定、可测试，也不会把最终彩蛋问得太明显；
 * - 只问“关心、距离、感受”，不出现“车票/礼物/彩蛋”这些词；
 * - 每题仍然落一个非空答案，复用后端 q1~q5 的加密存储；粗粒度档位走 meta。
 */
import type { Draft } from './domain';

export type Branch = 'lonely' | 'health' | 'emotion' | 'life';

export type Choice = { id: string; label: string };

export type QuestionView = {
  prompt: string;
  hint?: string;
  choices: Choice[];
  /** 是否允许在选项之外补一句自己的话 */
  freeText: boolean;
  placeholder: string;
  /** 孤单分支的 Q3：需要两个城市输入 */
  cityPair?: boolean;
  /** 预算题：允许直接填具体金额 */
  amountInput?: boolean;
};

const ALONE_CHOICES: Choice[] = [
  { id: 'alone', label: '常常一个人' },
  { id: 'busy', label: '忙起来顾不上自己' },
  { id: 'unwell', label: '身体有些不舒服' },
  { id: 'heavy', label: '心里压着事' },
  { id: 'other', label: '其他' },
];

const LONELY_DISTANCE: Choice[] = [
  { id: 'same_city', label: '同城' },
  { id: 'near', label: '高铁 2 小时内' },
  { id: 'far', label: '要坐很久的车' },
  { id: 'unknown', label: '说不清' },
];

const HEALTH_WORRY: Choice[] = [
  { id: 'legs', label: '腿脚 / 腰背' },
  { id: 'sleep', label: '睡眠' },
  { id: 'medicine', label: '吃药 / 复查' },
  { id: 'meal', label: '吃饭' },
  { id: 'other', label: '其他' },
];

const EMOTION_LAST_TALK: Choice[] = [
  { id: 'recent', label: '这几天' },
  { id: 'week', label: '这周' },
  { id: 'month', label: '这个月' },
  { id: 'long', label: '很久了' },
];

const LIFE_FOCUS: Choice[] = [
  { id: 'broken', label: '家里的东西坏了' },
  { id: 'buy', label: '想买点什么' },
  { id: 'go', label: '想去哪儿' },
  { id: 'unknown', label: '说不清' },
];

const BUDGET_CHOICES: Choice[] = [
  { id: 'under_100', label: '100 以内' },
  { id: '100_299', label: '100–299' },
  { id: '300_599', label: '300–599' },
  { id: '600_999', label: '600–999' },
  { id: '1000_plus', label: '1000 以上' },
];

const FEELING_CHOICES: Record<Branch, Choice[]> = {
  lonely: [
    { id: 'meet', label: '见到面' },
    { id: 'remembered', label: '被惦记' },
    { id: 'relieved', label: '松一口气' },
    { id: 'hope', label: '有个盼头' },
  ],
  health: [
    { id: 'checkup', label: '陪 TA 去检查' },
    { id: 'rest', label: '让 TA 好好休息' },
    { id: 'comfort', label: '给 TA 买件舒服的东西' },
    { id: 'share', label: '替 TA 分担一点' },
  ],
  emotion: [
    { id: 'heard', label: '被听见' },
    { id: 'accompanied', label: '被陪着' },
    { id: 'remembered', label: '被记得' },
    { id: 'encouraged', label: '被鼓励' },
  ],
  life: [
    { id: 'home', label: '家里舒服一点' },
    { id: 'errand', label: 'TA 少跑一趟' },
    { id: 'meal', label: '一起吃顿饭' },
    { id: 'gift', label: '一件小礼物' },
  ],
};

/** 以 Q2 的选择为主、Q1 的文本为辅，决定后面几题走哪条分支 */
export function branchOf(draft: Draft): Branch {
  const second = draft.choices[1];
  if (second === 'alone') return 'lonely';
  if (second === 'unwell') return 'health';
  if (second === 'busy' || second === 'heavy') return 'emotion';
  const text = draft.answers[0] ?? '';
  if (/一个人|没人说话|冷清|孤单|陪着|回家/.test(text)) return 'lonely';
  if (/疼|腿|腰|血压|体检|吃药|睡|失眠/.test(text)) return 'health';
  if (/考试|论文|考研|学习|难过|焦虑|烦|崩溃|压力/.test(text)) return 'emotion';
  return 'life';
}

export function questionsFor(draft: Draft): QuestionView[] {
  const branch = branchOf(draft);
  const q1 = draft.answers[0] ?? '';
  // Q2 也根据 Q1 的文本换一套更贴近的问法；选项 id 保持同一套，分支判定不受影响
  const q2 = /一个人|没人说话|冷清|孤单|陪|回家/.test(q1)
    ? {
      prompt: 'TA 一个人的时候，最让你放心不下的是什么？',
      choices: [
        { id: 'alone', label: '总是一个人吃饭' },
        { id: 'busy', label: '忙起来顾不上自己' },
        { id: 'unwell', label: '身体有些不舒服' },
        { id: 'heavy', label: '心里压着事' },
        { id: 'other', label: '其他' },
      ] as Choice[],
    }
    : /疼|腿|腰|血压|体检|吃药|睡|失眠|身体/.test(q1)
      ? {
        prompt: 'TA 的身体，最让你担心的是什么？',
        choices: [
          { id: 'unwell', label: '总说忍一忍就过去了' },
          { id: 'busy', label: '忙起来顾不上休息' },
          { id: 'alone', label: '一个人在家，没人搭把手' },
          { id: 'heavy', label: '心里也跟着压着事' },
          { id: 'other', label: '其他' },
        ] as Choice[],
      }
      : /考试|论文|考研|学习|难过|焦虑|烦|崩溃|压力/.test(q1)
        ? {
          prompt: 'TA 最近的心事，更接近哪一种？',
          choices: [
            { id: 'heavy', label: '压力很大，不太说出口' },
            { id: 'busy', label: '忙得没空休息' },
            { id: 'alone', label: '一个人扛着' },
            { id: 'unwell', label: '身体也跟着不舒服' },
            { id: 'other', label: '其他' },
          ] as Choice[],
        }
        : {
          prompt: 'TA 平时的生活里，有没有什么让你放心不下的？',
          choices: ALONE_CHOICES,
        };
  return [
    {
      prompt: '最近，TA 最让你挂念的是什么？',
      hint: '不用写得漂亮，具体一点就好。',
      choices: [],
      freeText: true,
      placeholder: '例如：她总说膝盖疼，却一直不肯去检查。',
    },
    {
      prompt: q2.prompt,
      hint: '选一个最接近的，也可以在下面补一句。',
      choices: q2.choices,
      freeText: true,
      placeholder: '想补充的话（可不填）',
    },
    branch === 'lonely'
      ? {
        prompt: '你们现在相隔多远？',
        hint: '这会影响后面的小计划，但不会直接告诉你要做什么。',
        choices: LONELY_DISTANCE,
        freeText: false,
        placeholder: 'TA 在的城市 / 你在的城市',
        cityPair: true,
      }
      : branch === 'health'
        ? {
          prompt: 'TA 最近的身体情况，哪一件最让你担心？',
          hint: '选一个最接近的。',
          choices: HEALTH_WORRY,
          freeText: true,
          placeholder: '想补充的话（可不填）',
        }
        : branch === 'emotion'
          ? {
            prompt: '上一次你们好好说话，是什么时候？',
            hint: '不用精确，凭感觉选就好。',
            choices: EMOTION_LAST_TALK,
            freeText: true,
            placeholder: '想补充的话（可不填）',
          }
          : {
            prompt: 'TA 最近反复提起的一件小事是什么？',
            hint: '越具体，后面的小计划越贴近 TA。',
            choices: LIFE_FOCUS,
            freeText: true,
            placeholder: '想补充的话（可不填）',
          },
    {
      prompt: '为了这件挂念的事，你每周大概能留出多少零花钱？',
      hint: '量力而行，之后也可以改。',
      choices: BUDGET_CHOICES,
      freeText: false,
      placeholder: '也可以直接填金额，例如：200',
      amountInput: true,
    },
    {
      prompt: '如果十天后能兑现一件小事，你更希望 TA 是什么感觉？',
      hint: '选一个最像你心里想的。',
      choices: FEELING_CHOICES[branch],
      freeText: true,
      placeholder: '想补充的话（可不填）',
    },
  ];
}

/** 把用户的选择翻译成后端可存的粗粒度档位；没有选择的字段不提交 */
export function metaOf(draft: Draft): Draft['meta'] {
  const branch = branchOf(draft);
  const second = draft.choices[1] ?? '';
  const aloneLevel =
    second === 'alone' ? 'high'
      : second === 'busy' || second === 'unwell' || second === 'heavy' ? 'medium'
        : second === 'other' ? 'low' : undefined;
  const third = draft.choices[2] ?? '';
  const fourth = draft.choices[3] ?? '';
  const travelBand = branch === 'lonely' && third !== '' ? third : undefined;
  const costBand = branch === 'lonely'
    ? third === 'same_city' ? 'under_100'
      : third === 'near' ? '100_299'
        : third === 'far' ? '300_599'
          : third === 'unknown' ? '100_299'
            : undefined
    : undefined;
  const lastHome = branch === 'emotion' && third !== '' ? third : undefined;
  const disposableBand = ['under_100', '100_299', '300_599', '600_999', '1000_plus'].includes(fourth)
    ? fourth
    : undefined;
  const giftCategory =
    branch === 'lonely' ? 'lonely'
      : branch === 'health' ? 'body'
        : branch === 'emotion' ? 'emotion'
          : 'life';
  return {
    giftCategory,
    aloneLevel,
    lastHome,
    travelBand,
    costBand,
    disposableBand,
  };
}

/** 选项点击后写入答案：保留用户补充的文字，只替换选项部分 */
export function withChoice(draft: Draft, step: number, choice: Choice): Draft {
  const answers = [...draft.answers];
  const choices = [...draft.choices];
  const previous = draft.answers[step] ?? '';
  const previousChoice = draft.choices[step];
  const previousLabel = previousChoice
    ? questionsFor(draft)[step]?.choices.find((item) => item.id === previousChoice)?.label
    : undefined;
  choices[step] = choice.id;
  if (previous === '' || previous === previousLabel) answers[step] = choice.label;
  return { ...draft, answers, choices };
}

/** 城市对输入：TA 的城市 / 我的城市，存成后端可解析的「TA|我」 */
export function withCities(draft: Draft, toCity: string, fromCity: string): Draft {
  const answers = [...draft.answers];
  answers[2] = [toCity.trim(), fromCity.trim()].filter(Boolean).join('|');
  return { ...draft, answers };
}

export function citiesOf(draft: Draft): { toCity: string; fromCity: string } {
  const [toCity = '', fromCity = ''] = (draft.answers[2] ?? '').split('|');
  return { toCity, fromCity };
}
