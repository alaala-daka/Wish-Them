import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCheck,
  Heart,
  ImagePlus,
  Leaf,
  LockKeyhole,
  Sprout,
  Upload,
} from 'lucide-react';
import { productDay, settleDue, weekStart, type Task } from '../domain';
import { prepareImage } from '../storage';
import { go, Heading, Mascot, Paper, WishCard } from '../components';
import NoWish from './NoWish';
import type { Props } from './types';

const isDone = (data: Props['data'], task: Task) =>
  task.status === 'done' ||
  task.status === 'made_up' ||
  data.checkins.some((checkin) => checkin.taskId === task.id);

const canMakeup = (data: Props['data'], task: Task) =>
  data.makeupAvailable && weekStart(task.date) === weekStart(productDay());

export function Today({ data, notify, isDemo, actions }: Props) {
  const wish = data.wish,
    day = productDay();
  const tasks = wish?.tasks.filter((t) => t.date === day) || [];
  const shownTasks = isDemo && wish ? wish.tasks.filter((t) => t.date === wish.start) : tasks;
  const [selected, setSelected] = useState<Task | null>(null),
    [image, setImage] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const current = selected ? data.checkins.find((c) => c.taskId === selected.id) : undefined;
  useEffect(() => {
    setSelected(null);
    setImage('');
    setNote('');
  }, [wish?.id]);
  async function upload(file?: File) {
    if (!file) return;
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
    if (!selected || !image || busy) return;
    setBusy(true);
    setError('');
    try {
      if (selected.status === 'missed') {
        await actions.makeup(selected.id, image, note.trim());
        notify('已用本周补卡券补上这件小事。');
      } else {
        await actions.checkin(selected.id, image, note.trim());
        notify('今天的小事已记录，心意又近了一点。');
      }
      setSelected(null);
      setImage('');
      setNote('');
    } catch (e) {
      setError((e as Error).message || '记录未保存，请重试。');
    } finally {
      setBusy(false);
    }
  }
  if (!wish)
    return (
      <div className="page">
        <NoWish />
      </div>
    );
  const due = settleDue(data);
  const completed = shownTasks.filter((t) => t.kind !== 'money' && isDone(data, t)).length;
  return (
    <div className="page">
      <Heading
        eyebrow="A LITTLE SOMETHING, TODAY"
        title="今天，也替心意走一小步"
        description="不用做很多。认真做完一件，就是很好的一天。"
      />
      <div className="today-layout">
        <aside>
          <WishCard wish={wish} />
          <div className="drawer">
            <span>?</span>
            <p>
              有一份心意
              <br />
              到时候再打开。
            </p>
          </div>
          <Mascot
            small
            message={
              completed === 2 ? '今天的两件小事，都好好收到了。' : '我会替你保管这些小小的认真。'
            }
          />
        </aside>
        <div>
          <div className="section-label">
            <h2>今天的小事</h2>
            <span className="tag green">已完成 {completed}/2</span>
          </div>
          {shownTasks.length ? (
            shownTasks.map((task) => {
              const done = isDone(data, task);
              const missed = task.status === 'missed';
              return (
                <Paper key={task.id} className={`task-card ${done ? 'done' : ''}`}>
                  <div className="task-heading">
                    <span className="task-symbol">
                      {task.kind === 'ta' ? (
                        <Heart />
                      ) : task.kind === 'self' ? (
                        <Leaf />
                      ) : (
                        <Sprout />
                      )}
                    </span>
                    <span className="eyebrow">
                      {task.kind === 'ta'
                        ? `为${wish.name}`
                        : task.kind === 'self'
                          ? '为自己'
                          : '周末可选'}
                      {task.kind === 'money' ? '' : ' · 必做'}
                    </span>
                    {done && (
                      <span className="done-label">
                        <Check size={14} />
                        {task.status === 'made_up' ? '已补卡' : '已完成'}
                      </span>
                    )}
                    {!done && missed && (
                      <span className="done-label missed-label">
                        {canMakeup(data, task) ? '可补卡' : '已错过'}
                      </span>
                    )}
                  </div>
                  <h3>{task.title}</h3>
                  <p>用一张照片或截图，收藏这件小事。</p>
                  <button
                    className={done ? 'secondary' : 'primary'}
                    disabled={isDemo && !done}
                    onClick={() => {
                      setSelected(task);
                      const c = data.checkins.find((r) => r.taskId === task.id);
                      setImage(c?.image || '');
                      setNote(c?.note || '');
                      setError('');
                    }}
                  >
                    {isDemo && !done
                      ? '演示模式只读'
                      : done
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
              <CheckCheck size={34} />
              <h2>这一份约定，已经走到这里</h2>
              <p>今天没有新的任务，可以翻翻记录。</p>
              {due && (
                <button className="primary" onClick={() => go('/settle')}>
                  查看约定结果
                </button>
              )}
            </Paper>
          )}
          <p className="quiet-note">
            <LockKeyhole size={14} />
            记录只属于你，不会出现在愿签池。
          </p>
        </div>
        <Paper className="record-panel">
          <span className="eyebrow">COLLECT A LITTLE MOMENT</span>
          <h2>{current ? '这件小事，留在这里' : '留下一点今天的痕迹'}</h2>
          <p>{selected ? selected.title : '先选一件今天的小事，再把照片放进来。'}</p>
          {!selected ? (
            <div className="upload-empty">
              <Camera size={40} />
              <span>左侧选择“去记录”开始</span>
            </div>
          ) : (
            <>
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!current) void upload(e.dataTransfer.files[0]);
                }}
                onPaste={(e) => {
                  if (!current) {
                    const file = Array.from(e.clipboardData.files)[0];
                    if (file) {
                      e.preventDefault();
                      void upload(file);
                    }
                  }
                }}
                tabIndex={0}
                role="group"
                aria-label="照片上传区，支持拖入或粘贴图片"
              >
                {image ? (
                  <img className="proof" src={image} alt="这次行动的私人记录" />
                ) : (
                  <>
                    <ImagePlus size={34} />
                    <p>把照片或截图放在这里</p>
                    <span>点击选择 · 拖入图片 · 粘贴截图</span>
                  </>
                )}
                {!current && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    <Upload size={15} />
                    {image ? '更换照片' : '选择照片'}
                  </button>
                )}
                <input
                  ref={input}
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
              </div>
              <label>
                留一句话（可选）
                <textarea
                  maxLength={30}
                  rows={3}
                  value={current?.note ?? note}
                  readOnly={!!current}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="今天有什么想记住的？"
                />
              </label>
              <div className="field-meta">
                <span>照片仅自己可见</span>
                <span>{(current?.note ?? note).length}/30</span>
              </div>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {current ? (
                <p className="tag green">
                  <Check size={14} />
                  已保存到账号
                </p>
              ) : selected.status === 'missed' && !canMakeup(data, selected) ? (
                <p className="muted">
                  这件小事已经错过，本周补卡券不可用或已跨周，下周会重新发放。
                </p>
              ) : (
                <>
                  <button className="primary full" disabled={!image || busy} onClick={submit}>
                    {busy
                      ? '正在处理…'
                      : selected.status === 'missed'
                        ? '用补卡券补上'
                        : '收好今天的记录'}
                  </button>
                  {!image && <p className="muted">添加照片后即可完成记录。</p>}
                  {selected.status === 'missed' && (
                    <p className="muted">补卡会使用本周唯一的一张券。</p>
                  )}
                </>
              )}
            </>
          )}
        </Paper>
      </div>
    </div>
  );
}
