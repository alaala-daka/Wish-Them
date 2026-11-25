import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Heart, Leaf, Sparkles, X } from 'lucide-react';
import { go, Mascot, Paper } from '../components';

type TourStep = 'welcome' | 'wish' | 'questions' | 'contract' | 'days' | 'ellipsis' | 'summary' | 'egg' | 'end';

type TourTask = {
  id: string;
  kind: 'ta' | 'self' | 'money';
  title: string;
  tags: string[];
  amount?: number;
};

const DAY_TASKS: Record<number, TourTask[]> = {
  1: [
    { id: 'd1-ta', kind: 'ta', title: '给姥姥打一通电话，问问今天吃了什么。', tags: ['陪伴', '沟通', '生活'] },
    { id: 'd1-self', kind: 'self', title: '按时吃一顿正经饭，拍一张餐盘。', tags: ['自理', '健康'] },
  ],
  2: [
    { id: 'd2-ta', kind: 'ta', title: '把今天的晚饭拍给姥姥，问她一个人吃了什么。', tags: ['心意', '陪伴', '生活'] },
    { id: 'd2-self', kind: 'self', title: '出门走十分钟，看看路边的树。', tags: ['自理', '行动'] },
    { id: 'd2-money', kind: 'money', title: '本周自己做饭代替两次外卖，把省下的钱记下来。', tags: ['省钱', '生活'], amount: 60 },
  ],
  3: [
    { id: 'd3-ta', kind: 'ta', title: '和姥姥约好周末回去吃一顿饭，记下她想吃什么。', tags: ['心意', '沟通', '陪伴'] },
    { id: 'd3-self', kind: 'self', title: '把书桌收拾出一个空位，拍一张照片。', tags: ['自理', '行动'] },
  ],
};

const STEP_ORDER: TourStep[] = ['welcome', 'wish', 'questions', 'contract', 'days', 'ellipsis', 'summary', 'egg', 'end'];

const MASCOT_LINES: Record<TourStep, string> = {
  welcome: '我是小愿。今天不用等十天，我带你走一遍完整的心意旅程。',
  wish: '先替一个重要的人，写下一句具体的牵挂。不用漂亮，真心就很好。',
  questions: '接下来是几个小问题。它们会跟着你的回答慢慢变得不一样，别急。',
  contract: '签下约定后，每天会有两件小事。做不完也没关系，邮局会替你记着。',
  days: '点一下「完成」，就当作今天的小事做好了。金额任务也只要填一个数，不用真的上传照片。',
  ellipsis: '十天里，每天都是这样一小步。我们跳过中间的日子，直接去看看结果。',
  summary: '十天后，你认真做过的小事，和一点点攒下的钱，都在这里了。',
  egg: '最后，是邮局替你收着的彩蛋。它不一定贵重，但会尽量贴近你心里那个人。',
  end: '流程就走到这里。现在，换你来许一个愿吧。',
};

function Ellipsis() {
  return (
    <div className="tour-ellipsis" aria-label="时间快进中">
      <span>·</span>
      <span>·</span>
      <span>·</span>
      <p>十天里，每天都是这样一小步</p>
    </div>
  );
}

export default function Tour() {
  const [step, setStep] = useState<TourStep>('welcome');
  const [day, setDay] = useState(1);
  const [done, setDone] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({ 'd2-money': '60' });

  useEffect(() => {
    if (step !== 'ellipsis') return;
    const timer = setTimeout(() => setStep('summary'), 1900);
    return () => clearTimeout(timer);
  }, [step]);

  const index = STEP_ORDER.indexOf(step);
  const tasks = useMemo(() => DAY_TASKS[day] ?? [], [day]);
  const dayDone = tasks.every((task) => done.includes(task.id));

  const back = () => {
    if (step === 'days' && day > 1) {
      setDay(day - 1);
      return;
    }
    if (index > 0) setStep(STEP_ORDER[index - 1]);
  };
  const next = () => {
    if (step === 'ellipsis') return;
    if (step === 'days') {
      if (!dayDone) return;
      if (day < 3) {
        setDay(day + 1);
        return;
      }
      setStep('ellipsis');
      return;
    }
    if (index < STEP_ORDER.length - 1) setStep(STEP_ORDER[index + 1]);
  };

  const complete = (task: TourTask) => {
    if (task.kind === 'money' && !(amounts[task.id] ?? '').trim()) return;
    setDone((current) => (current.includes(task.id) ? current : [...current, task.id]));
  };

  return (
    <div className="tour">
      <div className="tour-top">
        <button className="text-button" onClick={() => go('/')}>
          <ArrowLeft size={15} /> 回邮局
        </button>
        <div className="tour-progress" aria-label="流程进度">
          {STEP_ORDER.map((item, itemIndex) => (
            <span key={item} className={itemIndex <= index ? 'done' : ''} />
          ))}
        </div>
        <button className="icon-button" aria-label="退出流程速览" onClick={() => go('/')}>
          <X size={17} />
        </button>
      </div>

      <div className="tour-stage">
        <Paper className="tour-paper">
          {step === 'welcome' && (
            <div className="tour-center">
              <span className="eyebrow">A LITTLE TOUR</span>
              <h1>三分钟，看完整段心意</h1>
              <p>这是一段演示数据，不会影响你的真实愿签。跟着小愿点「下一步」就好。</p>
              <div className="tour-tags">
                <span className="tag">许愿</span>
                <span className="tag">十天小事</span>
                <span className="tag">攒钱</span>
                <span className="tag">彩蛋</span>
              </div>
            </div>
          )}

          {step === 'wish' && (
            <div className="tour-center">
              <span className="eyebrow">WRITE A LITTLE WISH</span>
              <h1>替姥姥，许一个小小的愿</h1>
              <div className="wish-card">
                <Heart size={26} />
                <span className="eyebrow">一封认真收藏的心意</span>
                <h2>替姥姥许愿</h2>
                <p>她一个人在老家，希望她别总是一个人吃饭，也能有人陪着说说话。</p>
                <div className="wish-sign">愿每一份心意，都慢慢靠近。</div>
              </div>
              <p className="muted">真实使用时，这里可以写 120 字，也可以让 AI 帮你找表达。</p>
            </div>
          )}

          {step === 'questions' && (
            <div className="tour-center">
              <span className="eyebrow">A FEW SMALL QUESTIONS</span>
              <h1>问题会跟着你的回答变</h1>
              <div className="tour-question-list">
                <div>
                  <span>01</span>
                  <p>最近，TA 最让你挂念的是什么？</p>
                  <em>她一个人在老家，吃饭总是凑合。</em>
                </div>
                <div>
                  <span>02</span>
                  <p>TA 平时的生活里，有没有什么让你放心不下的？</p>
                  <em>常常一个人</em>
                </div>
                <div>
                  <span>03</span>
                  <p>你们现在相隔多远？</p>
                  <em>高铁 2 小时内 · 北京 → 济南</em>
                </div>
                <div>
                  <span>04</span>
                  <p>为了这件挂念的事，你每周大概能留出多少零花钱？</p>
                  <em>300–599</em>
                </div>
                <div>
                  <span>05</span>
                  <p>如果十天后能兑现一件小事，你更希望 TA 是什么感觉？</p>
                  <em>见到面</em>
                </div>
              </div>
              <p className="muted">这些答案只会加密保存在账号里，不会公开。</p>
            </div>
          )}

          {step === 'contract' && (
            <div className="tour-center">
              <span className="eyebrow">A TEN-DAY PROMISE</span>
              <h1>十天，每天两件小事</h1>
              <ul className="contract">
                <li>每天两件必做小事，每件不超过十分钟。</li>
                <li>周末有一件可选的金额任务，做完填上实际省下或挣到的钱。</li>
                <li>照片和金额只自己可见。</li>
                <li>十天后，邮局会替你打开结果和彩蛋。</li>
              </ul>
              <p className="tag green">
                <Check size={14} /> 约定已签下
              </p>
            </div>
          )}

          {step === 'days' && (
            <div className="tour-days">
              <div className="section-label">
                <h2>第 {day} 天的小事</h2>
                <span className="tag green">演示数据</span>
              </div>
              <p className="muted">点「完成」即可，不用上传照片。金额任务默认填好了，也可以改。</p>
              {tasks.map((task) => {
                const isDone = done.includes(task.id);
                return (
                  <div key={task.id} className={`tour-task ${isDone ? 'done' : ''}`}>
                    <div className="task-tags">
                      {task.tags.map((tag) => (
                        <span key={tag} className={`tag ${task.kind === 'money' ? 'money' : ''}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="tour-task-main">
                      <div>
                        <h3>{task.title}</h3>
                        <span className="muted">
                          {task.kind === 'ta' ? '为姥姥' : task.kind === 'self' ? '为自己' : '周末可选'}
                        </span>
                      </div>
                      {task.kind === 'money' && !isDone && (
                        <label className="tour-amount">
                          这次省下（元）
                          <input
                            type="number"
                            min="1"
                            max="2000"
                            value={amounts[task.id] ?? ''}
                            onChange={(e) => setAmounts({ ...amounts, [task.id]: e.target.value })}
                          />
                        </label>
                      )}
                      <button
                        className={isDone ? 'secondary' : 'primary'}
                        onClick={() => complete(task)}
                        disabled={isDone}
                      >
                        {isDone ? (
                          <>
                            <Check size={15} /> 已完成
                          </>
                        ) : (
                          '完成'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!dayDone && <p className="muted">把今天的小事都完成，就可以进入下一天。</p>}
            </div>
          )}

          {step === 'ellipsis' && <Ellipsis />}

          {step === 'summary' && (
            <div className="tour-center">
              <span className="eyebrow">TEN DAYS LATER</span>
              <h1>十天的小事，攒成了一件真的事</h1>
              <div className="tour-summary">
                <div>
                  <strong>20</strong>
                  <span>件必做小事</span>
                </div>
                <div>
                  <strong>¥480</strong>
                  <span>任务省下</span>
                </div>
                <div>
                  <strong>¥200</strong>
                  <span>任务挣到</span>
                </div>
                <div className="total">
                  <strong>¥680</strong>
                  <span>累计心意</span>
                </div>
              </div>
              <p>这十天里，你为姥姥做了很多小事，也真的为自己留下了一点钱。</p>
              <p className="muted">以上是演示数据，真实使用时金额来自你每天填写的数字。</p>
            </div>
          )}

          {step === 'egg' && (
            <div className="tour-center">
              <span className="eyebrow">
                拆开彩蛋 · <Sparkles size={13} /> AI辅助
              </span>
              <h1>一张回家的往返车票</h1>
              <div className="easter-egg tour-egg revealed">
                <p>
                  用这十天攒下的 ¥680，把「北京 → 济南」的往返车票变成一次真的见面。回去那天，陪姥姥吃一顿饭，不急着走。
                </p>
                <ol>
                  <li>先查北京到济南的周末车次，避开最贵的一班。</li>
                  <li>把这笔钱单独放进一个信封，写上「给姥姥的车票」。</li>
                  <li>回去那天，陪姥姥吃一顿饭，问问她最近一个人都在忙什么。</li>
                </ol>
                <span className="easter-cost">参考 ¥300–500 · 现在已经够得着</span>
                <p className="easter-closing">有些距离，一张车票就能缩短。</p>
              </div>
              <p className="muted">真实使用时，彩蛋会结合你填写的城市、距离、预算和愿望方向来生成。</p>
            </div>
          )}

          {step === 'end' && (
            <div className="tour-center">
              <span className="eyebrow">YOUR TURN</span>
              <h1>现在，换你来许一个愿</h1>
              <p>不用等准备好。从今天的一件小事开始，就已经很好了。</p>
              <div className="tour-actions">
                <button className="primary" onClick={() => go('/start')}>
                  去许愿 <ArrowRight size={16} />
                </button>
                <button className="secondary" onClick={() => go('/')}>
                  回邮局首页
                </button>
              </div>
            </div>
          )}

          {step !== 'ellipsis' && step !== 'end' && (
            <div className="tour-nav">
              <button className="text-button" onClick={back} disabled={step === 'welcome'}>
                <ArrowLeft size={15} /> 上一步
              </button>
              <button className="primary" onClick={next} disabled={step === 'days' && !dayDone}>
                {step === 'days' ? (day < 3 ? '下一天' : '看看十天后') : '下一步'}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </Paper>

        <aside className="tour-mascot">
          <Mascot message={MASCOT_LINES[step]} />
          <div className="tour-footnote">
            <Leaf size={14} /> 演示数据 · 不影响真实愿签
          </div>
        </aside>
      </div>
    </div>
  );
}
