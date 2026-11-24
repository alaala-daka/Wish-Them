import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, BookOpen, Sun, Waves, UserRound, X, Leaf, Copy } from 'lucide-react';
import {
  ApiError,
  addLedgerEntry as apiAddLedgerEntry,
  checkinTask,
  createReply,
  createWish as apiCreateWish,
  demoScenario,
  demoSession,
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
  demoData,
  localSettlementView,
  productDay,
  weekStart,
  type AppData,
  type Draft,
} from './domain';
import { loadData, saveData } from './storage';
import { clearSession, ensureSession, saveSession, type StoredSession } from './session';
import { loadRemoteSnapshot, mapDemoState } from './remote';
import type { Actions } from './actions';
import { go } from './components';
import { Home, Today, Ledger, Pool, Mine, Settle } from './pages';
import Create from './Create';

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
  const [route, setRoute] = useState(
    location.hash.slice(1) ||
      (location.pathname.startsWith('/demo') || location.search.includes('demo=1') ? '/demo' : '/'),
  );
  const [data, setData] = useState<AppData | null>(null),
    [demo, setDemo] = useState<AppData | null>(null),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [notice, setNotice] = useState(''),
    [demoOutcome, setDemoOutcomeState] = useState<'full' | 'cyber' | 'unfinished'>('full');
  const stateRef = useRef<AppData | null>(null),
    localRef = useRef<AppData>(emptyData()),
    sessionRef = useRef<StoredSession | null>(null),
    demoTokenRef = useRef(''),
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
  }, [commit]);

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

  // 独立演示：优先使用后端真实演示引擎（任务/账本/结算都是真规则），失败时退回本机示例。
  useEffect(() => {
    if (route !== '/demo' || demo) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await demoSession();
        if (cancelled) return;
        demoTokenRef.current = result.session.access_token;
        setDemo(mapDemoState(result.state));
      } catch {
        if (cancelled) return;
        setDemo(demoData());
        notify('后端演示不可用，已切换为本机示例。');
      }
      go('/today');
    })();
    return () => {
      cancelled = true;
    };
  }, [route, demo, notify]);

  const update: Update = (fn) => {
    if (demo) {
      setDemo((d) => fn(d!));
      return Promise.resolve();
    }
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
      });
      await signContract(session.token, created.wish.id, 7);
      createKeyRef.current = '';
      const next = { ...(stateRef.current ?? localRef.current), draft: emptyDraft() };
      await persistLocal(next);
      if (stateRef.current) commit({ ...stateRef.current, draft: emptyDraft() });
      await refresh();
    },

    async checkin(taskId: string, imageDataUrl: string, note: string) {
      const session = requireSession();
      const proofId = await uploadImage(
        session.token,
        imageDataUrl,
        'checkin_proof',
        requireWishId(),
      );
      await checkinTask(session.token, taskId, proofId, note.trim());
      await refresh();
    },

    async makeup(taskId: string, imageDataUrl: string, note: string) {
      const session = requireSession();
      const proofId = await uploadImage(
        session.token,
        imageDataUrl,
        'checkin_proof',
        requireWishId(),
      );
      await makeupTask(session.token, taskId, proofId, note.trim());
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

    async extend() {
      const session = requireSession();
      await extendWish(session.token, requireWishId());
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

  const demoActions: Actions = {
    ...actions,
    async createWish() {
      throw new Error('演示模式只读，退出演示后再许愿。');
    },
    async checkin() {
      throw new Error('演示模式只读，退出演示后再记录。');
    },
    async makeup() {
      throw new Error('演示模式只读，退出演示后再补卡。');
    },
    async setWeekBudget() {
      throw new Error('演示模式只读，退出演示后再记账。');
    },
    async addLedgerEntry() {
      throw new Error('演示模式只读，退出演示后再记账。');
    },
    async settle() {
      throw new Error('演示结果由上方按钮切换。');
    },
    async extend() {
      throw new Error('演示模式不支持续期。');
    },
    async polish() {
      throw new Error('演示模式不调用 AI 润色。');
    },
    async listPool() {
      return [];
    },
    async getPost() {
      throw new Error('演示模式只展示示例愿签。');
    },
    async replyToPost() {
      throw new Error('演示模式只读。');
    },
    async recover() {
      throw new Error('请退出演示后再找回账号。');
    },
    async logout() {
      throw new Error('请先退出演示。');
    },
    async refresh() {
      // no-op
    },
  };

  async function setDemoOutcome(outcome: 'full' | 'cyber' | 'unfinished') {
    setDemoOutcomeState(outcome);
    const backendOutcome =
      outcome === 'full' ? 'double_realized' : outcome === 'cyber' ? 'cyber_only' : 'failed';
    try {
      const result = await demoScenario(demoTokenRef.current, backendOutcome);
      setDemo(mapDemoState(result.state));
    } catch {
      const local = demoData(outcome);
      setDemo({
        ...local,
        settlement: localSettlementView(local),
        wishStatus: 'settled',
        wish: local.wish ? { ...local.wish, status: 'settled' } : null,
      });
      notify('后端演示切换失败，已使用本机示例结局。');
    }
  }

  async function openDemoSettlement() {
    await setDemoOutcome(demoOutcome);
    go('/settle');
  }

  const active = demo || data;
  const pageActions = demo ? demoActions : actions;
  const pageProps = {
    data: active || emptyData(),
    update,
    notify,
    isDemo: !!demo,
    actions: pageActions,
  };
  const nav = [
    ['/', '邮局首页', Mail],
    ['/today', '今日', Sun],
    ['/pool', '愿签池', Waves],
    ['/ledger', '账本', BookOpen],
    ['/me', '我的', UserRound],
  ] as const;
  let content;
  if (!active) content = <div className="loading">{error || '正在打开暖木邮局…'}</div>;
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
      case '/demo':
        content = <div className="loading">正在准备演示…</div>;
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
      {notice && (
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
      {demo && (
        <div className="demo-bar">
          <span>独立演示 · 不影响你的愿签</span>
          <div>
            <select
              aria-label="演示结局"
              value={demoOutcome}
              onChange={(e) =>
                void setDemoOutcome(e.target.value as 'full' | 'cyber' | 'unfinished')
              }
            >
              <option value="full">双重兑现</option>
              <option value="cyber">赛博实现</option>
              <option value="unfinished">未完成</option>
            </select>
            <button onClick={() => void openDemoSettlement()}>查看两幕结算</button>
            <button
              onClick={() => {
                setDemo(null);
                demoTokenRef.current = '';
                go('/');
              }}
            >
              退出演示
            </button>
          </div>
        </div>
      )}
      <main id="main-content" tabIndex={-1}>
        {content}
      </main>
      <footer className="site-footer">
        <span>愿TA · 暖木愿望邮局</span>
        <span>账号云端保存 · 五问与照片仅自己可见</span>
        <span>每一件小事，都算数。</span>
      </footer>
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
