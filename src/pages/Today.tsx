import { useEffect, useRef, useState } from 'react';
import { productDay, settleDue, weekStart, type Task } from '../domain';
import { prepareImage } from '../storage';
import { go, Mascot, Paper, WishCard } from '../components';
import NoWish from './NoWish';
import type { Props } from './types';
import { PixelIcon } from '../PixelIcon';
import './Today.css';

const isDone = (data: Props['data'], task: Task) =>
  task.status === 'done' ||
  task.status === 'made_up' ||
  data.checkins.some((checkin) => checkin.taskId === task.id);

const canMakeup = (data: Props['data'], task: Task) =>
  data.makeupAvailable && weekStart(task.date) === weekStart(productDay());

export function Today({ data, notify, actions }: Props) {
  const wish = data.wish,
    day = productDay();
  const tasks = wish?.tasks.filter((t) => t.date === day) || [];
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [image, setImage] = useState(''),
    [note, setNote] = useState(''),
    [amount, setAmount] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const recordHeading = useRef<HTMLHeadingElement>(null);
  const selected = tasks.find((task) => task.id === selectedId);
  const current = selected ? data.checkins.find((c) => c.taskId === selected.id) : undefined;
  useEffect(() => {
    setSelectedId(null);
    setImage('');
    setNote('');
    setAmount('');
    setError('');
  }, [wish?.id]);
  const canEdit =
    !!selected &&
    !isDone(data, selected) &&
    (selected.status !== 'missed' || canMakeup(data, selected));
  async function upload(file?: File) {
    if (!file || !canEdit || busy) return;
    setBusy(true);
    setError('');
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!selected || !canEdit || !image || busy) return;
    let amountCents: number | undefined;
    if (selected.kind === 'money') {
      const yuan = Number(amount);
      if (!amount || !Number.isInteger(yuan) || yuan <= 0 || yuan > 2000) {
        setError('请填写这次实际省下或挣到的金额（1~2000 元的整数）。');
        return;
      }
      amountCents = yuan * 100;
    }
    setBusy(true);
    setError('');
    try {
      if (selected.status === 'missed') {
        await actions.makeup(selected.id, image, note.trim(), amountCents);
        notify('已用本周补卡券补上这件小事。');
      } else {
        await actions.checkin(selected.id, image, note.trim(), amountCents);
        notify('今天的小事已记录，心意又近了一点。');
      }
      recordHeading.current?.focus({
        preventScroll: !window.matchMedia('(max-width: 640px)').matches,
      });
      setSelectedId(null);
      setImage('');
      setNote('');
      setAmount('');
    } catch (e) {
      setError((e as Error).message || '记录未保存，请重试。');
    } finally {
      setBusy(false);
    }
  }
  if (!wish)
    return (
      <div className="page postal-waiting">
        <NoWish />
      </div>
    );
  const due = settleDue(data);

  const requiredTasks = tasks.filter((task) => task.kind !== 'money');
  const completed = requiredTasks.filter((task) => isDone(data, task)).length;
  const finished = requiredTasks.length > 0 && completed === requiredTasks.length;
  return (
    <div className="today-scene">
      <header className="today-scene-header">
        <div className="today-hanging-sign">
          <span>
            <PixelIcon name="mail" size={20} /> 暖木愿望邮局
          </span>
          <h1>今天，也替心意走一小步</h1>
        </div>
        <Mascot
          small
          message={finished ? '今天的两件小事，都好好收到了。照片只替你收着。' : '照片只替你收着。'}
        />
      </header>
      <div className="today-counter">
        <aside className="today-wish" aria-label="这份心意">
          <WishCard wish={wish} />
          <div className="today-lockbox">
            <div className="today-lockbox-plate" aria-hidden="true">
              <PixelIcon name="question" size={35} />
              <PixelIcon name="lock" size={22} />
            </div>
            <p>到时候再打开</p>
          </div>
        </aside>
        <section className="today-board" aria-labelledby="today-board-heading">
          <div className="today-board-heading">
            <h2 id="today-board-heading">
              <PixelIcon name="heart" size={24} /> 今天的小事
            </h2>
            {requiredTasks.length > 0 && (
              <span className="today-tally">
                已完成 {completed}/{requiredTasks.length}
              </span>
            )}
          </div>
          {tasks.length ? (
            tasks.map((task) => {
              const done = isDone(data, task);
              const missed = task.status === 'missed';
              const active = selected?.id === task.id;
              return (
                <Paper
                  key={task.id}
                  className={`today-task ${done ? 'today-task-done' : ''} ${active ? 'today-task-active' : ''}`}
                >
                  <div className="today-task-heading">
                    <PixelIcon
                      name={task.kind === 'ta' ? 'heart' : task.kind === 'self' ? 'book' : 'coin'}
                      size={30}
                    />
                    <span className="today-task-kind">
                      {task.kind === 'ta'
                        ? `为${wish.name}`
                        : task.kind === 'self'
                          ? '为自己'
                          : '周末可选'}
                      {task.kind === 'money' ? '' : ' · 必做'}
                    </span>
                    {done && (
                      <span className="today-task-stamp">
                        <PixelIcon name="check" size={16} />
                        {task.status === 'made_up' ? '已补卡' : '已完成'}
                      </span>
                    )}
                    {!done && missed && (
                      <span className="today-task-stamp today-task-missed">
                        {canMakeup(data, task) ? '可补卡' : '已错过'}
                      </span>
                    )}
                  </div>
                  {task.tags.length > 0 && (
                    <div className="task-tags" aria-label="任务标签">
                      {task.tags.map((tag) => (
                        <span key={tag} className={`tag ${task.kind === 'money' ? 'money' : ''}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <h3>{task.title}</h3>
                  <p>
                    {task.kind === 'money'
                      ? '拍下凭证，并填上这次实际省下或挣到的钱。'
                      : '用一张照片或截图，收藏这件小事。'}
                    {done && task.amountCents
                      ? ` 已${task.moneyKind === 'save' ? '省' : '挣'} ¥${Math.floor(task.amountCents / 100)}。`
                      : ''}
                  </p>
                  <button
                    className={done ? 'secondary' : 'primary'}
                    disabled={busy}
                    aria-controls="today-record"
                    aria-current={active || undefined}
                    onClick={() => {
                      setSelectedId(task.id);
                      recordHeading.current?.focus();
                      if (active) return;
                      const c = data.checkins.find((r) => r.taskId === task.id);
                      setImage(c?.image || '');
                      setNote(c?.note || '');
                      setAmount(task.amountCents ? String(Math.floor(task.amountCents / 100)) : '');
                      setError('');
                    }}
                  >
                    {done
                      ? '查看记录'
                      : missed
                        ? canMakeup(data, task)
                          ? '去补卡'
                          : '已错过'
                        : '去记录'}
                  </button>
                </Paper>
              );
            })
          ) : (
            <Paper className="empty">
              <PixelIcon name="check" size={34} />
              <h2>这一份约定，已经走到这里</h2>
              <p>今天没有新的任务，可以翻翻记录。</p>
              {due && (
                <button className="primary" onClick={() => go('/settle')}>
                  查看约定结果
                </button>
              )}
            </Paper>
          )}
          <p className="today-board-note">
            每天 04:00（中国时间）更新当天的小事。周末会自动出现金额任务。
          </p>
        </section>
        <section className="today-record" id="today-record" aria-labelledby="today-record-heading">
          <h2 id="today-record-heading" ref={recordHeading} tabIndex={-1}>
            <PixelIcon name="pen" size={25} /> 记录小事
          </h2>
          <p className="today-record-selection">
            {selected ? selected.title : '先选一件今天的小事'}
          </p>
          {!selected ? (
            <div className="today-upload today-upload-idle">
              <PixelIcon name="camera" size={40} />
              <span>选择任务上的“去记录”开始</span>
            </div>
          ) : (
            <>
              <div
                className="today-upload"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (canEdit) void upload(e.dataTransfer.files[0]);
                }}
                onPaste={(e) => {
                  if (canEdit && !busy) {
                    const file = Array.from(e.clipboardData.files)[0];
                    if (file) {
                      e.preventDefault();
                      void upload(file);
                    }
                  }
                }}
                tabIndex={canEdit ? 0 : undefined}
                role="group"
                aria-label="照片上传区，支持拖入或粘贴图片"
              >
                {current?.image || image ? (
                  <img
                    className="today-proof"
                    src={current?.image || image}
                    alt="这次行动的私人记录"
                  />
                ) : (
                  <>
                    <PixelIcon name="camera" size={42} />
                    <p>{canEdit ? '上传照片或截图' : '暂无可查看的照片'}</p>
                    {canEdit && <span>点击选择 · 拖入图片 · 粘贴截图</span>}
                  </>
                )}
                {canEdit && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    {image ? '更换照片' : '选择照片'}
                  </button>
                )}
                <input
                  ref={input}
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              <label>
                留一句话（可选）
                <textarea
                  maxLength={30}
                  rows={3}
                  value={current?.note ?? note}
                  readOnly={!canEdit || busy}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="今天有什么想记住的？"
                />
              </label>
              <div className="field-meta">
                <span>{(current?.note ?? note).length}/30</span>
              </div>
              {selected.kind === 'money' &&
                (current || canEdit) &&
                (current ? (
                  <p className="tag money">
                    这次{current.amountKind === 'earned' ? '挣到' : '省下'} ¥
                    {Math.floor((current.amountCents ?? 0) / 100)}
                  </p>
                ) : (
                  <label>
                    这次实际{selected.moneyKind === 'earn' ? '挣到' : '省下'}（元）
                    <input
                      type="number"
                      min="1"
                      max="2000"
                      step="1"
                      inputMode="numeric"
                      disabled={busy}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={selected.moneyKind === 'earn' ? '例如：80' : '例如：30'}
                    />
                  </label>
                ))}
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {current ? (
                <p className="tag green">
                  <PixelIcon name="check" size={16} />
                  已保存到账号
                </p>
              ) : isDone(data, selected) ? (
                <p className="muted">这件小事已完成。</p>
              ) : !canEdit ? (
                <p className="muted">
                  这件小事已经错过，本周补卡券不可用或已跨周，下周会重新发放。
                </p>
              ) : (
                <>
                  <button
                    className="primary full"
                    disabled={!image || busy || (selected.kind === 'money' && !amount)}
                    onClick={submit}
                  >
                    {busy
                      ? '正在处理…'
                      : selected.status === 'missed'
                        ? '用补卡券补上'
                        : '保存记录'}
                  </button>
                  {!image && <p className="muted">添加照片后即可完成记录。</p>}
                  {image && selected.kind === 'money' && !amount && (
                    <p className="muted">再填上这次的金额，就可以收好了。</p>
                  )}
                  {selected.status === 'missed' && (
                    <p className="muted">补卡会使用本周唯一的一张券。</p>
                  )}
                </>
              )}
            </>
          )}
          <p className="today-privacy">
            <PixelIcon name="lock" size={17} /> 记录只属于你
          </p>
        </section>
      </div>
    </div>
  );
}
