import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, MailOpen, Sparkles } from 'lucide-react';
import { settleDue } from '../domain';
import { go, Heading, Mascot, Paper, WishCard } from '../components';
import NoWish from './NoWish';
import type { Props } from './types';

const outcomeCopy = {
  double_realized: '一次体贴的小礼物，或许已经不远了',
  cyber_only: '你的愿望已在这里实现，还有一封未拆的信',
  unrealized: '把未完成的心意，慢慢接着做',
} as const;

export function Settle({ data, update, notify, actions }: Props) {
  const view = data.settlement;
  const due = settleDue(data);
  const [act, setAct] = useState(1),
    [letter, setLetter] = useState(
      data.letter ||
        view?.second_act.letter_text ||
        `亲爱的${data.wish?.name || 'TA'}：\n有些关心一直没好好说出口。最近我做了一些小事，也慢慢学着照顾自己。愿你一直被认真惦记着。`,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [renewing, setRenewing] = useState(false),
    [renewDays, setRenewDays] = useState(1),
    [eggOpen, setEggOpen] = useState(false);
  const tried = useRef(false),
    letterTouched = useRef(false);

  useEffect(() => {
    setAct(1);
    setEggOpen(false);
    tried.current = false;
  }, [data.wish?.id, view?.settlement_version, view?.first_act.outcome]);

  useEffect(() => {
    if (view && !letterTouched.current && !data.letter) setLetter(view.second_act.letter_text);
  }, [view, data.letter]);

  // 到期后进入结算页：真实账号自动请求一次结算；重复进入由服务端 already_settled 兜底。
  useEffect(() => {
    if (!due || view || tried.current) return;
    tried.current = true;
    setBusy(true);
    actions
      .settle()
      .catch((e) => setError((e as Error).message || '结算暂时没有完成，请稍后重试。'))
      .finally(() => setBusy(false));
  }, [due, view, actions]);

  if (!data.wish)
    return (
      <div className="page">
        <NoWish />
      </div>
    );

  if (!due && !view)
    return (
      <div className="page">
        <Paper className="empty">
          <LockKeyhole size={36} />
          <h1>这份心意，还在慢慢生长</h1>
          <p>
            约定到期后，邮局会为你打开结果。
            {data.settleOpenAt && `（${new Date(data.settleOpenAt).toLocaleString()} 开放）`}
          </p>
          <button className="primary" onClick={() => go('/today')}>
            去做今天的小事
          </button>
        </Paper>
      </div>
    );

  if (!view)
    return (
      <div className="page">
        <Paper className="empty">
          <LockKeyhole size={36} />
          <h1>{busy ? '正在打开你的结果…' : '结果暂时没有打开'}</h1>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void actions.settle().catch((e) => setError((e as Error).message))}
          >
            再试一次
          </button>
        </Paper>
      </div>
    );

  const first = view.first_act;
  const second = view.second_act;
  const complete = first.outcome !== 'unrealized';
  const outcome = first.outcome;

  return (
    <div className="page">
      <Heading
        eyebrow={act === 1 ? 'A PROMISE, CAREFULLY KEPT' : 'FROM A WISH TO SOMETHING REAL'}
        title={
          act === 1
            ? complete
              ? '你把一句祝愿，做成了小事'
              : '未完成的小事，也会留在这里'
            : '原来，心意已经攒了这么多'
        }
        description={
          act === 1 ? '先看看这些日子里，你认真做过的事。' : '接下来的一步，可以走到现实里。'
        }
      />
      <div className="settle-layout">
        <WishCard wish={data.wish} />
        <Paper className="settle-paper">
          {act === 1 ? (
            <>
              <div className={`stamp ${first.stamped ? '' : 'unfinished'}`}>
                {first.stamped ? '已还愿' : '待续的心意'}
              </div>
              <h2>{complete ? '这份约定，你做到了。' : '不用急着给自己一个结论。'}</h2>
              <p>
                为 TA 与为自己的小事，记录了 {first.tasks.checkin_count} 件；必做完成{' '}
                {first.tasks.must_done}/{first.tasks.must_total}，钱任务完成{' '}
                {first.tasks.money_done}/{first.tasks.money_total}。
              </p>
              <p className="muted">
                {first.outcome_label} · 结算版本 {view.settlement_version}
              </p>
              {!complete && <p>还有未完成的必做任务。本次不会盖“已还愿”印章。</p>}
              <button className="primary" onClick={() => setAct(2)}>
                继续，打开问号抽屉
              </button>
            </>
          ) : (
            <>
              <span className="eyebrow">你的心意账本</span>
              <div className="settle-sum">
                <span>任务省下 ¥{Math.floor(second.saved_cents / 100)}</span>
                <span>＋ 任务挣到 ¥{Math.floor(second.earned_cents / 100)}</span>
                <strong>¥{second.realized_yuan}</strong>
              </div>
              <h2>{outcomeCopy[outcome]}</h2>
              {!second.easter_egg && second.gift && (
                <div className="gift-note">
                  <strong>{second.gift.title}</strong>
                  <p>{second.gift.note}</p>
                  <span>
                    参考价 ¥{second.gift.min_yuan}–{second.gift.max_yuan} · {second.gap_band_label}
                    {second.gap_cents > 0 ? ` · 还差 ¥${second.gap_yuan}` : ''}
                  </span>
                </div>
              )}
              {!second.easter_egg && <p>{second.copy_text}</p>}
              {second.easter_egg && (
                !eggOpen ? (
                  <div className="egg-sealed">
                    <span className="eyebrow">最后一件小事</span>
                    <MailOpen size={30} />
                    <h2>这里还藏着一个彩蛋</h2>
                    <p>用这十天攒下的钱，邮局替你想了一件事。</p>
                    <button className="primary" onClick={() => setEggOpen(true)}>
                      <Sparkles size={16} />
                      拆开彩蛋
                    </button>
                  </div>
                ) : (
                  <div className="easter-egg revealed">
                    <span className="eyebrow">
                      拆开彩蛋 · {second.easter_egg.ai_label}
                    </span>
                    <h2>{second.easter_egg.title}</h2>
                    <p>{second.easter_egg.summary}</p>
                    <ol>
                      {second.easter_egg.plan_steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <span className="easter-cost">
                      参考 ¥{Math.floor(second.easter_egg.cost_min_cents / 100)}–
                      {Math.floor(second.easter_egg.cost_max_cents / 100)}
                      {second.easter_egg.affordable
                        ? ' · 现在已经够得着'
                        : ` · 还差 ¥${Math.floor(second.easter_egg.gap_cents / 100)}`}
                    </span>
                    <p className="easter-closing">{second.easter_egg.closing}</p>
                  </div>
                )
              )}
              <label>
                写给TA的信
                <textarea
                  rows={7}
                  maxLength={1000}
                  value={letter}
                  onChange={(e) => {
                    letterTouched.current = true;
                    setLetter(e.target.value);
                  }}
                />
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await update((d) => ({ ...d, letter }));
                    notify('这封信已保存在本机。');
                  } catch {
                    notify('保存失败，请重试。');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存心意
              </button>
              {view.extension.can_extend && (
                <div className="renew-box">
                  <div className="section-label">
                    <h2>要再续一段吗？</h2>
                    <span className="tag">最多 5 天</span>
                  </div>
                  <p className="muted">
                    不续也完全可以。这份心意已经好好收在这里；想继续的话，自己选一个长度就好。
                  </p>
                  <div className="renew-choice">
                    <button
                      className={renewing ? 'secondary' : 'primary'}
                      onClick={() => setRenewing(false)}
                    >
                      先到这里
                    </button>
                    <button
                      className={renewing ? 'primary' : 'secondary'}
                      onClick={() => setRenewing(true)}
                    >
                      再续一段
                    </button>
                  </div>
                  {!renewing && (
                    <button className="text-button" onClick={() => go('/')}>
                      带着这份心意回首页
                    </button>
                  )}
                  {renewing && (
                    <>
                      <div className="renew-wheel" role="radiogroup" aria-label="选择续期天数">
                        <div className="renew-wheel-face">
                          {[1, 2, 3, 4, 5].map((day, index) => (
                            <button
                              key={day}
                              type="button"
                              role="radio"
                              aria-checked={renewDays === day}
                              className={renewDays === day ? 'selected' : ''}
                              style={{ ['--i' as string]: index }}
                              onClick={() => setRenewDays(day)}
                            >
                              {day}
                            </button>
                          ))}
                          <span className="renew-wheel-center">
                            <strong>{renewDays}</strong>
                            <small>天</small>
                          </span>
                        </div>
                      </div>
                      <button
                        className="primary full"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await actions.extend(renewDays);
                            notify(`已续 ${renewDays} 天，新的任务已经补上。`);
                            go('/today');
                          } catch (e) {
                            notify((e as Error).message || '续期失败，请稍后再试。');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? '正在续上…' : `再续 ${renewDays} 天`}
                      </button>
                    </>
                  )}
                </div>
              )}
              <button className="text-button" onClick={() => setAct(1)}>
                再看一次约定
              </button>
            </>
          )}
        </Paper>
        <Mascot
          message={
            act === 1 ? '每一件认真做过的小事，我都记得。' : '这封信，终于可以交到你手上啦。'
          }
        />
      </div>
    </div>
  );
}
