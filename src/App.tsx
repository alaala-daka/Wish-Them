import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, BookOpen, Sun, Waves, UserRound, X, Leaf, Copy } from 'lucide-react';
import {
  ApiError,
  addLedgerEntry as apiAddLedgerEntry,
  checkinTask,
  createReply,
  createWish as apiCreateWish,
  extendWish,
  getPoolPost,
  listPool,
  listReplies,
  makeupTask,
  polishWish,
  recover as apiRecover,
  logout as apiLogout,
  saveAnswers,
  setWeekBudget as apiSetWeekBudget,
  settleWish,
  signContract,
  uploadImage,
} from './api';
import {
  emptyData,
  emptyDraft,
  productDay,
  weekStart,
  type AppData,
  type Draft,
} from './domain';
import { loadData, saveData } from './storage';
import { clearSession, ensureSession, saveSession, type StoredSession } from './session';
import { loadRemoteSnapshot } from './remote';
import type { Actions } from './actions';
import { go } from './components';
import { Home, Today, Ledger, Pool, Mine, Settle } from './pages';
import Create from './Create';
import Tour from './pages/Tour';

export type Update = (fn: (data: AppData) => AppData) => Promise<void>;

const localOnly = (data: AppData): AppData => ({
  ...emptyData(),
  draft: data.draft,
  replies: data.replies,
  letter: data.letter,
  celebration: data.celebration,
});

const mergeLocal = (local: AppData, remote: Partial<AppData>): AppData => ({
  ...emptyData(),
  ...remote,
  draft: local.draft,
  replies: local.replies,
  letter: local.letter || remote.settlement?.second_act.letter_text || '',
  celebration: local.celebration,
});

const pronounToApi = (pronoun: string): 'she' | 'he' | 'they' =>
  pronoun === '她' ? 'she' : pronoun === '他' ? 'he' : 'they';

export default function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || '/');
  const [data, setData] = useState<AppData | null>(null),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [notice, setNotice] = useState('');
  const stateRef = useRef<AppData | null>(null),
    localRef = useRef<AppData>(emptyData()),
    sessionRef = useRef<StoredSession | null>(null),
    createKeyRef = useRef(''),
    queue = useRef(Promise.resolve());

  const notify = useCallback((message: string) => setToast(message), []);

  const commit = useCallback((next: AppData) => {
    stateRef.current = next;
    setData(next);
  }, []);

  const persistLocal = useCallback(async (next: AppData) => {
    const stored = localOnly(next);
    await saveData(stored);
    localRef.current = stored;
    return stored;
  }, []);

  const refresh = useCallback(async () => {
    let session = sessionRef.current;
    if (!session) {
      session = await ensureSession();
      sessionRef.current = session;
    }
    try {
      const snapshot = await loadRemoteSnapshot(session.token);
      commit(
        mergeLocal(localRef.current, {
          ...snapshot,
          recoveryCode: session.recoveryCode,
        }),
      );
    } catch (first) {
      if (first instanceof ApiError && first.status === 401) {
        // Token 失效：清掉本机会话，自动注册新游客；用户仍可在「我的」用恢复码找回旧账号。
        clearSession();
        session = await ensureSession();
        sessionRef.current = session;
        const snapshot = await loadRemoteSnapshot(session.token);
        commit(mergeLocal(localRef.current, { ...snapshot, recoveryCode: session.recoveryCode }));
        return;
      }
      throw first;
    }
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 流程速览是纯前端演示：不注册游客、不请求后端，后端没开也能完整走完
      if (route === '/tour') return;
      // 已加载过就不再重复拉取；从 /tour 返回时若还没加载，则在这里补一次
      if (stateRef.current) return;
      const local = await loadData().catch(() => emptyData());
      localRef.current = local;
      const session = await ensureSession();
      sessionRef.current = session;
      const snapshot = await loadRemoteSnapshot(session.token);
      if (cancelled) return;
      commit(mergeLocal(local, { ...snapshot, recoveryCode: session.recoveryCode }));
      let seen = '0';
      try {
        seen = localStorage.getItem('yuanta.recovery_seen') ?? '0';
      } catch {
        seen = '1';
      }
      if (session.recoveryCode && seen !== '1') setNotice(session.recoveryCode);
    })().catch((err) => {
      if (cancelled) return;
      commit(mergeLocal(localRef.current, {}));
      setError(
        err instanceof ApiError
          ? `${err.message} 当前只能查看本机草稿，请确认后端已启动（npm run server）。`
          : '无法连接后端，当前只能查看本机草稿。',
      );
    });
    const onHash = () => setRoute(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHash);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHash);
    };
  }, [commit, route]);

  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(id);
    }
  }, [toast]);

  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(''), 15000);
      return () => clearTimeout(id);
    }
  }, [notice]);

  const update: Update = (fn) => {
    const operation = queue.current.then(async () => {
      const base = stateRef.current ?? localRef.current;
      const next = fn(base);
      const stored = await persistLocal(next);
      commit({ ...next, draft: stored.draft, replies: stored.replies, letter: stored.letter });
    });
    queue.current = operation.catch(() => {
      setError('本机保存失败，请检查浏览器储存空间后重试。');
    });
    return operation;
  };

  const requireSession = (): StoredSession => {
    const session = sessionRef.current;
    if (!session) throw new Error('还没有登录，请刷新页面重试。');
    return session;
  };

  const requireWishId = (): string => {
    const id = stateRef.current?.wish?.id;
    if (!id) throw new Error('请先签下愿签。');
    return id;
  };

  const actions: Actions = {
    async createWish(draft: Draft, _signature: string) {
      const session = requireSession();
      const missing = draft.answers.findIndex((answer) => !answer.trim());
      if (missing >= 0) throw new Error(`请先回答第 ${missing + 1} 个问题，再签下约定。`);
      // 弱网/连点重试沿用同一个幂等键；创建成功后再清空，避免留下多份草稿。
      const key = createKeyRef.current || crypto.randomUUID();
      createKeyRef.current = key;
      let created;
      try {
        created = await apiCreateWish(
          session.token,
          {
            relation: draft.relation,
            nickname: draft.name.trim(),
            pronoun: pronounToApi(draft.pronoun),
            wish_text: draft.text.trim(),
          },
          key,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          createKeyRef.current = '';
        }
        throw error;
      }
      await saveAnswers(session.token, created.wish.id, {
        q1: draft.answers[0].trim(),
        q2: draft.answers[1].trim(),
        q3: draft.answers[2].trim(),
        q4: draft.answers[3].trim(),
        q5: draft.answers[4].trim(),
      }, draft.meta as Record<string, string>);
      await signContract(session.token, created.wish.id, 10);
      createKeyRef.current = '';
      const next = { ...(stateRef.current ?? localRef.current), draft: emptyDraft() };
      await persistLocal(next);
      if (stateRef.current) commit({ ...stateRef.current, draft: emptyDraft() });
      await refresh();
    },

    async checkin(taskId: string, imageDataUrl: string, note: string, amountCents?: number) {
      const session = requireSession();
      const proofId = await uploadImage(
        session.token,
        imageDataUrl,
        'checkin_proof',
        requireWishId(),
      );
      await checkinTask(session.token, taskId, proofId, note.trim(), amountCents);
      await refresh();
    },

    async makeup(taskId: string, imageDataUrl: string, note: string, amountCents?: number) {
      const session = requireSession();
      const proofId = await uploadImage(
        session.token,
        imageDataUrl,
        'checkin_proof',
        requireWishId(),
      );
      await makeupTask(session.token, taskId, proofId, note.trim(), amountCents);
      await refresh();
    },

    async setWeekBudget(cents: number) {
      const session = requireSession();
      await apiSetWeekBudget(session.token, requireWishId(), weekStart(productDay()), cents);
      await refresh();
    },

    async addLedgerEntry(kind, cents, note, taskId) {
      const session = requireSession();
      await apiAddLedgerEntry(session.token, {
        wish_id: requireWishId(),
        week_start: weekStart(productDay()),
        type: kind === 'income' ? 'earning' : 'expense',
        amount_cents: cents,
        note: note.trim() || undefined,
        task_id: kind === 'income' ? taskId : undefined,
      });
      await refresh();
    },

    async settle() {
      const session = requireSession();
      await settleWish(session.token, requireWishId());
      await refresh();
    },

    async extend(days: number) {
      const session = requireSession();
      await extendWish(session.token, requireWishId(), days);
      await refresh();
    },

    async polish(text: string, relation: string) {
      const session = requireSession();
      return polishWish(session.token, text, relation);
    },

    async listPool(category?: string) {
      return (await listPool(category)).items;
    },

    async getPost(id: string) {
      const [post, replies] = await Promise.all([getPoolPost(id), listReplies(id)]);
      return { post: post.post, replies: replies.items };
    },

    async replyToPost(id: string, content: string) {
      const session = requireSession();
      await createReply(session.token, id, content);
    },

    async recover(code: string) {
      const result = await apiRecover(code);
      const session = saveSession({
        token: result.session.access_token,
        expiresAt: result.session.expires_at,
        recoveryCode: result.recovery_code,
        userId: result.user.id,
        nickname: result.user.nickname,
      });
      sessionRef.current = session;
      await refresh();
    },

    async logout() {
      const session = sessionRef.current;
      if (session) await apiLogout(session.token).catch(() => undefined);
      clearSession();
      const local = emptyData();
      localRef.current = local;
      await saveData(local).catch(() => undefined);
      sessionRef.current = null;
      stateRef.current = null;
      setData(null);
      await refresh();
    },

    refresh,
  };

  const active = data;
  const pageProps = {
    data: active || emptyData(),
    update,
    notify,
    actions,
  };
  const nav = [
    ['/', '邮局首页', Mail],
    ['/today', '今日', Sun],
    ['/pool', '愿签池', Waves],
    ['/ledger', '账本', BookOpen],
    ['/me', '我的', UserRound],
  ] as const;
  let content;
  if (route === '/tour') content = <Tour />;
  else if (!active) content = <div className="loading">{error || '正在打开暖木邮局…'}</div>;
  else
    switch (route) {
      case '/':
        content = <Home {...pageProps} />;
        break;
      case '/start':
        content = <Create {...pageProps} />;
        break;
      case '/today':
        content = <Today {...pageProps} />;
        break;
      case '/ledger':
        content = <Ledger {...pageProps} />;
        break;
      case '/pool':
        content = <Pool {...pageProps} />;
        break;
      case '/me':
        content = <Mine {...pageProps} />;
        break;
      case '/settle':
        content = <Settle {...pageProps} />;
        break;
      default:
        content = (
          <div className="empty">
            <h1>这封信还没有寄到这里</h1>
            <button onClick={() => go('/')}>回邮局首页</button>
          </div>
        );
    }
  return (
    <>
      <a
        className="skip"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        跳到主要内容
      </a>
      {route !== '/tour' && (
      <header className="topbar">
        <a href="#/" className="brand" aria-label="愿TA 邮局首页">
          <Mail strokeWidth={1.8} />
          <strong>愿TA</strong>
          <span>暖木愿望邮局</span>
        </a>
        <nav aria-label="主要导航">
          {nav.map(([path, label, Icon]) => (
            <a
              key={path}
              href={`#${path}`}
              className={route === path ? 'active' : ''}
              aria-current={route === path ? 'page' : undefined}
            >
              <Icon size={17} />
              {label}
            </a>
          ))}
        </nav>
        <span className="header-note">
          <Leaf size={16} /> 把心意带到现实
        </span>
      </header>
      )}
      {route !== '/tour' && notice && (
        <div className="recovery-banner" role="status">
          <strong>请保存恢复码</strong>
          <span>{notice}（换设备找回账号时使用，只展示这一次）</span>
          <button
            className="icon-button"
            aria-label="复制恢复码"
            onClick={() =>
              void navigator.clipboard?.writeText(notice).then(() => notify('恢复码已复制。'))
            }
          >
            <Copy size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => {
              try {
                localStorage.setItem('yuanta.recovery_seen', '1');
              } catch {
                // 忽略隐私模式下的存储异常
              }
              setNotice('');
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <main id="main-content" tabIndex={-1}>
        {content}
      </main>
      {route !== '/tour' && (
        <footer className="site-footer">
          <span>愿TA · 暖木愿望邮局</span>
          <span>账号云端保存 · 五问与照片仅自己可见</span>
          <span>每一件小事，都算数。</span>
        </footer>
      )}
      {toast && (
        <div className="toast" role="status">
          <Mail size={18} />
          {toast}
        </div>
      )}
      {error && active && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="关闭错误提示" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
