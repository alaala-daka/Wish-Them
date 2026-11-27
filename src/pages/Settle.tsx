import { useEffect, useRef, useState } from 'react';

import { settleDue } from '../domain';
import { go, Mascot, Paper } from '../components';
import { PixelIcon } from '../PixelIcon';
import { EggNotice, yuan } from './EggNotice';
import './Settle.css';
import NoWish from './NoWish';
import type { Props } from './types';

const outcomeCopy = {
  double_realized: '一次体贴的小礼物，或许已经不远了',
  cyber_only: '你的愿望已在这里实现，还有一封未拆的信',
  unrealized: '把未完成的心意，慢慢接着做',
} as const;

export function Settle({ data, update, notify, actions, isDemo }: Props) {
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
  const title = useRef<HTMLHeadingElement>(null);
  const eggTitle = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef<'title' | 'egg' | null>(null);
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
    if (!due || view || isDemo || tried.current) return;
    tried.current = true;
    setBusy(true);
    actions
      .settle()
      .catch((e) => setError((e as Error).message || '结算暂时没有完成，请稍后重试。'))
      .finally(() => setBusy(false));
  }, [due, view, isDemo, actions]);

  useEffect(() => {
    if (moveFocus.current === 'title') {
      title.current?.focus({ preventScroll: window.matchMedia('(min-width: 961px)').matches });
    }
    if (moveFocus.current === 'egg') eggTitle.current?.focus();
    moveFocus.current = null;
  }, [act, eggOpen]);

  if (!data.wish)
    return (
      <div className="page postal-waiting postal-waiting-night">
        <NoWish />
      </div>
    );

  if (!due && !view)
    return (
      <div className="page postal-waiting postal-waiting-night">
        <Paper className="empty">
          <PixelIcon name="lock" size={36} />
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
      <div className="page postal-waiting postal-waiting-night">
        <Paper className="empty">
          <PixelIcon name="lock" size={36} />
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

  const egg = second.easter_egg;
  const changeAct = (nextAct: number) => {
    moveFocus.current = 'title';
    setAct(nextAct);
    setEggOpen(false);
  };

  return (
    <div className="settlement-scene">
      <header className="settlement-banner settlement-paper">
        <h1 ref={title} tabIndex={-1}>
          {act === 2
            ? '原来，心意已经攒了这么多'
            : complete
              ? '你把一句祝愿，做成了小事'
              : '未完成的小事，也会留在这里'}
        </h1>
        <ol className="settlement-progress" aria-label="还愿进度">
          <li aria-current={act === 1 ? 'step' : undefined}>还愿盖章</li>
          <li aria-current={act === 2 ? 'step' : undefined}>打开抽屉</li>
        </ol>
      </header>
      <div className={`settlement-board ${act === 1 ? 'settlement-board-review' : ''}`}>
        <aside className="settlement-records" aria-label="愿签与心意账本">
          <section className="settlement-paper settlement-wish">
            <h2>
              <PixelIcon name="mail" size={25} /> 替{data.wish.name}许愿
            </h2>
            <p>{data.wish.text}</p>
            <strong
              className={`settlement-stamp ${first.stamped ? '' : 'settlement-stamp-pending'}`}
            >
              {first.stamped ? '已还愿' : '待续的心意'}
            </strong>
          </section>
          {act === 2 && (
            <section className="settlement-paper settlement-ledger">
              <h2>
                <PixelIcon name="book" size={29} /> 心意账本
              </h2>
              <dl>
                <div>
                  <dt>任务省下</dt>
                  <dd>{yuan(second.saved_cents)}</dd>
                </div>
                <div>
                  <dt>任务挣到</dt>
                  <dd>{yuan(second.earned_cents)}</dd>
                </div>
                <div>
                  <dt>共计</dt>
                  <dd>{yuan(second.realized_cents)}</dd>
                </div>
              </dl>
            </section>
          )}
        </aside>
        <div className="settlement-drawer-zone">
          <div className="settlement-drawer-content">
            {act === 1 ? (
              <section className="settlement-paper settlement-review">
                <h2>{complete ? '这份约定，你做到了。' : '不用急着给自己一个结论。'}</h2>
                <p>记录了 {first.tasks.checkin_count} 件小事</p>
                <dl>
                  <div>
                    <dt>必做任务</dt>
                    <dd>
                      {first.tasks.must_done}/{first.tasks.must_total}
                    </dd>
                  </div>
                  <div>
                    <dt>钱任务</dt>
                    <dd>
                      {first.tasks.money_done}/{first.tasks.money_total}
                    </dd>
                  </div>
                </dl>
                <p className="muted">
                  {first.outcome_label} · 结算版本 {view.settlement_version}
                </p>
                {!complete && <p>还有未完成的必做任务。本次不会盖“已还愿”印章。</p>}
              </section>
            ) : egg ? (
              eggOpen ? (
                <EggNotice egg={egg} titleRef={eggTitle} />
              ) : (
                <div className="settlement-envelope">
                  <h2>{outcomeCopy[outcome]}</h2>
                  <div className="settlement-envelope-folds" aria-hidden="true" />
                  <button
                    className="settlement-wax"
                    onClick={() => {
                      moveFocus.current = 'egg';
                      setEggOpen(true);
                    }}
                  >
                    <PixelIcon name="mail" size={29} />
                    <span>拆开彩蛋</span>
                  </button>
                </div>
              )
            ) : (
              <section className="settlement-paper settlement-review">
                <h2>{outcomeCopy[outcome]}</h2>
                {second.gift && (
                  <div className="gift-note">
                    <strong>{second.gift.title}</strong>
                    <p>{second.gift.note}</p>
                    <span>
                      参考 {yuan(second.gift.min_cents)}–{yuan(second.gift.max_cents).slice(1)} ·{' '}
                      {second.gap_band_label}
                      {second.gap_cents > 0 ? ` · 还差 ${yuan(second.gap_cents)}` : ''}
                    </span>
                  </div>
                )}
                <p>{second.copy_text}</p>
              </section>
            )}
            <div className="settlement-drawer-front">
              {act === 1 ? (
                <button className="settlement-drawer-handle" onClick={() => changeAct(2)}>
                  <PixelIcon name="question" size={24} /> 打开问号抽屉
                </button>
              ) : (
                <span className="settlement-drawer-handle" aria-hidden="true">
                  <PixelIcon name="question" size={31} />
                </span>
              )}
            </div>
          </div>
          <Mascot
            message={
              act === 1
                ? '先看看你做过的小事。准备好了，就拉开问号抽屉。'
                : egg && !eggOpen
                  ? '点一下红色火漆，就能拆开这封信。'
                  : '可以把想对 TA 说的话写在旁边，留给自己慢慢看。'
            }
          />
        </div>
        {act === 2 && (
          <section className="settlement-paper settlement-letter">
            <label>
              <span className="settlement-letter-heading">
                <PixelIcon name="pen" size={30} /> 写给TA的信
              </span>
              <span className="settlement-letter-privacy">
                <PixelIcon name="lock" size={15} /> 仅自己可见
              </span>
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
              保存这封信
            </button>
            {isDemo && <p className="muted">演示中的结果不会改变你的真实愿签。</p>}
            {!isDemo && view.extension.can_extend && (
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
            <button className="text-button" onClick={() => changeAct(1)}>
              再看一次约定
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
