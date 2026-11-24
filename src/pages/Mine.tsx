import { useState } from 'react';
import { Copy, Download, KeyRound, LogOut } from 'lucide-react';
import { emptyDraft, settleDue } from '../domain';
import { go, Heading, Mascot, Paper, WishCard } from '../components';
import type { Props } from './types';

export function Mine({ data, update, notify, actions, isDemo }: Props) {
  const [recovery, setRecovery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');

  function exportData() {
    const payload = {
      version: data.version,
      wish: data.wish
        ? {
            name: data.wish.name,
            text: data.wish.text,
            relation: data.wish.relation,
            start: data.wish.start,
            end: data.wish.endDate,
            status: data.wish.status,
          }
        : null,
      ledger: data.ledger,
      records: data.checkins.map((checkin) => ({ note: checkin.note, at: checkin.at })),
      settlement: data.settlement ?? null,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = '愿TA-心意记录.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <Heading eyebrow="YOUR OWN LITTLE POSTBOX" title="你的心意，都好好收在这里" />
      <div className="two-column">
        <Paper>
          <h2>我的愿签</h2>
          {data.wish ? (
            <>
              <WishCard wish={data.wish} />
              <div className="button-row">
                <button className="primary" onClick={() => go('/today')}>
                  查看今天的小事
                </button>
                {settleDue(data) && (
                  <button className="secondary" onClick={() => go('/settle')}>
                    {data.settlement ? '查看结算结果' : '打开约定结果'}
                  </button>
                )}
                {data.wish.status === 'settled' && (
                  <button className="secondary" onClick={() => go('/start')}>
                    再许一个愿
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p>还没有愿签。第一份心意，会寄给谁呢？</p>
              <button className="primary" onClick={() => go('/start')}>
                替TA许个愿
              </button>
            </>
          )}
        </Paper>
        <Paper>
          <h2>账号与本机数据</h2>
          <p>
            当前账号：<strong>{data.currentUser?.nickname || '暖木邮局的访客'}</strong>
            {data.currentUser?.id && (
              <span className="muted"> · {data.currentUser.id.slice(0, 8)}</span>
            )}
          </p>
          <p>愿签、任务与账本保存在云端账号；五问答案加密保存，照片通过短时签名链接访问。</p>
          {data.recoveryCode && (
            <div className="recovery-code">
              <span>恢复码（换设备登录用）</span>
              <code>{data.recoveryCode}</code>
              <button
                className="secondary"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(data.recoveryCode!)
                    .then(() => notify('恢复码已复制。'))
                }
              >
                <Copy size={15} /> 复制
              </button>
            </div>
          )}
          {!isDemo && (
            <form
              className="recover-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!recovery.trim() || busy) return;
                setBusy(true);
                setError('');
                try {
                  await actions.recover(recovery.trim());
                  setRecovery('');
                  notify('已找回原账号。');
                } catch (err) {
                  setError((err as Error).message || '恢复码无效或暂时无法登录。');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                用恢复码找回账号
                <input
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                  placeholder="26 位恢复码，可带连字符"
                  autoComplete="off"
                />
              </label>
              <button className="secondary" disabled={busy || !recovery.trim()}>
                <KeyRound size={15} /> {busy ? '正在找回…' : '找回账号'}
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="secondary full" onClick={exportData}>
            <Download size={16} />
            导出文字记录
          </button>
          <p className="muted">导出不含五问答案和照片，不可用于跨设备恢复。</p>
          {!isDemo && (
            <>
              <button
                className="text-button"
                onClick={async () => {
                  if (
                    window.confirm('清除本机草稿、示例回信与本地信件？云端愿签和记录不会删除。')
                  ) {
                    try {
                      await update((d) => ({
                        ...d,
                        draft: emptyDraft(),
                        replies: {},
                        letter: '',
                        celebration: false,
                      }));
                      notify('本机草稿与缓存已清除。');
                    } catch {
                      notify('清除失败，请重试。');
                    }
                  }
                }}
              >
                清除本机草稿与缓存
              </button>
              <button
                className="text-button danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      '退出当前账号？本机 Token 会被清除；未保存恢复码的账号将无法找回。',
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await actions.logout();
                    notify('已退出当前账号，并创建了新的访客会话。');
                  } catch (err) {
                    notify((err as Error).message || '退出失败，请重试。');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <LogOut size={14} /> 退出当前账号
              </button>
            </>
          )}
          <Mascot small message="心意不必很大，但每一份都值得认真。" />
        </Paper>
      </div>
    </div>
  );
}
