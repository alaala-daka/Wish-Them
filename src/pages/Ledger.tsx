import { useState } from 'react';
import { Plus, BookOpen } from 'lucide-react';
import type { LedgerEntry } from '../domain';
import { Heading, Paper } from '../components';
import { PixelIcon } from '../PixelIcon';
import NoWish from './NoWish';
import type { Props } from './types';

const kindLabel = (kind: LedgerEntry['kind']) =>
  kind === 'budget'
    ? '周预算'
    : kind === 'expense'
      ? '非必要支出'
      : kind === 'saved'
        ? '省下'
        : '收入';

export function Ledger({ data, notify, actions, isDemo }: Props) {
  const [kind, setKind] = useState<'expense' | 'budget' | 'saved'>('expense'),
    [amount, setAmount] = useState(''),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const summary = data.ledgerTotals ?? { saved: 0, earned: 0, total: 0 };
  const settled = data.wish?.status === 'settled';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const yuan = Number(amount);
    if (!amount || !Number.isFinite(yuan) || yuan < 0 || !Number.isInteger(yuan)) {
      setError('请填写整数金额（元）。');
      return;
    }
    const cents = Math.round(yuan * 100);
    if (cents > 200_000) {
      setError('单笔金额不能超过 2000 元。');
      return;
    }
    if (kind !== 'budget' && cents === 0) {
      setError('金额需要大于 0 元。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (kind === 'budget') await actions.setWeekBudget(cents);
      else await actions.addLedgerEntry(kind, cents, note);
      setAmount('');
      setNote('');
      notify(
        kind === 'budget'
          ? '本周预算已更新。'
          : kind === 'saved'
            ? '这笔省下，已累加进心愿基金。'
            : '这一笔，已记到账本。',
      );
    } catch (e) {
      setError((e as Error).message || '账目没有保存，请重试。');
    } finally {
      setBusy(false);
    }
  }

  if (!data.wish)
    return (
      <div className="page">
        <NoWish />
      </div>
    );
  return (
    <div className="page">
      <Heading
        eyebrow="SMALL CHANGE, REAL CARE"
        title="把一点一滴，记成心意"
        description="真实的金额，不必很多。量力而行，已经足够。"
      />
      <div className="ledger-summary">
        <Paper>
          <span className="ledger-caption">
            <PixelIcon name="coin" size={22} /> 累计省下
          </span>
          <strong>¥{summary.saved}</strong>
        </Paper>
        <Paper>
          <span className="ledger-caption">
            <PixelIcon name="stamp" size={22} /> 累计挣到
          </span>
          <strong>¥{summary.earned}</strong>
        </Paper>
        <Paper className="total">
          <span className="ledger-caption">
            <PixelIcon name="heart" size={22} /> 累计心意
          </span>
          <strong>¥{summary.total}</strong>
        </Paper>
      </div>
      <div className="two-column">
        <Paper>
          <div className="section-label">
            <h2>我的账页</h2>
            <span className="tag">按自然周记录</span>
          </div>
          <p className="muted">
            金额任务的省下/收入会在今日页打卡时自动累加；也可以在这里手动记一笔省下。周预算结余只作参考，不计入累计心意。
          </p>
          {data.ledger.length ? (
            [...new Set(data.ledger.map((entry) => entry.week))]
              .sort()
              .reverse()
              .map((w) => (
                <div key={w} className="ledger-week">
                  <h3>{w} 起的一周</h3>
                  {data.ledger
                    .filter((entry) => entry.week === w)
                    .map((entry) => (
                      <div className="ledger-row" key={entry.id}>
                        <div>
                          <strong>{entry.note}</strong>
                          <span>{kindLabel(entry.kind)}</span>
                        </div>
                        <b>¥{entry.amount}</b>
                      </div>
                    ))}
                </div>
              ))
          ) : (
            <div className="empty">
              <BookOpen size={36} />
              <h3>账本的第一页，留给今天</h3>
              <p>完成金额任务并填写实际金额，或在这里手动记一笔省下。</p>
            </div>
          )}
          <p className="muted">流水只追加、不提供删除；如需更正金额，请再记录一笔并说明。</p>
        </Paper>
        <Paper>
          <h2>记下一笔</h2>
          {settled ? (
            <p className="muted">这份约定已经结算，账本已归档，不能再追加记录。</p>
          ) : isDemo ? (
            <p className="muted">演示模式只读；退出演示后可以记账。</p>
          ) : (
            <form onSubmit={submit}>
              <label>
                记账类型
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'expense' | 'budget' | 'saved')}
                >
                  <option value="expense">非必要支出</option>
                  <option value="saved">省下一笔</option>
                  <option value="budget">设置本周预算</option>
                </select>
              </label>
              <label>
                金额（元，取整）
                <input
                  required
                  type="number"
                  min="0"
                  max={2000}
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                记一点说明
                <input
                  maxLength={30}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：本周少喝两杯奶茶"
                />
              </label>
              <p className="muted">
                「省下一笔」会直接累加到累计心意；金额任务打卡填写的金额也会自动进来，不用重复填写。
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary full" disabled={busy}>
                <Plus size={17} />
                {busy ? '正在记账…' : '记到账本'}
              </button>
            </form>
          )}
          <div className="drawer inline">
            <span>?</span>
            <p>
              这份积累会去向哪里？
              <br />
              约定到期，再一起打开。
            </p>
          </div>
        </Paper>
      </div>
    </div>
  );
}
