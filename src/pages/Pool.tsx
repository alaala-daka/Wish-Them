import { useEffect, useRef, useState } from 'react';
import { Mail, X } from 'lucide-react';
import { Heading, Paper } from '../components';
import { CATEGORY_TO_TYPE, categoryLabel } from '../remote';
import type { ReplyDto } from '../api';
import type { Props } from './types';

type PoolPostView = {
  id: string;
  name: string;
  category: string;
  text: string;
  author: string;
  source: 'sample' | 'server';
};

const samplePosts: PoolPostView[] = [
  {
    id: 'one',
    name: '妈妈',
    category: '睡眠',
    text: '希望妈妈每天都能睡个好觉，不用再为小事操心。',
    author: '一位在外读书的人',
    source: 'sample',
  },
  {
    id: 'two',
    name: '室友',
    category: '学业',
    text: '希望室友准备了那么久的考试，能有一个让他开心的结果。',
    author: '同一屋檐下的朋友',
    source: 'sample',
  },
  {
    id: 'three',
    name: '姥姥',
    category: '孤单',
    text: '希望姥姥一个人在家的时候，也总有人陪她说说话。',
    author: '想家的小孩',
    source: 'sample',
  },
  {
    id: 'four',
    name: '爸爸',
    category: '身体',
    text: '希望爸爸下班后别太累，也记得给自己一点休息。',
    author: '不太会表达的人',
    source: 'sample',
  },
  {
    id: 'five',
    name: '闺蜜',
    category: '情绪',
    text: '希望她走过这一小段低落，重新找到自己喜欢的日常。',
    author: '一直在她身边的人',
    source: 'sample',
  },
  {
    id: 'six',
    name: '一个陌生人',
    category: '生活',
    text: '希望每天清晨路过的早餐摊阿姨，今天也有好心情。',
    author: '路过的一份心意',
    source: 'sample',
  },
];

const filters = ['全部', '身体', '睡眠', '孤单', '学业', '情绪', '生活'];

export function Pool({ data, update, notify, actions, isDemo }: Props) {
  const [filter, setFilter] = useState('全部'),
    [posts, setPosts] = useState<PoolPostView[]>(samplePosts),
    [selected, setSelected] = useState<PoolPostView | null>(null),
    [serverReplies, setServerReplies] = useState<ReplyDto[]>([]),
    [reply, setReply] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const serverSeen = useRef(false);
  const usingServer = posts.some((post) => post.source === 'server');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setPosts(samplePosts);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const items = await actions.listPool(
          filter === '全部' ? undefined : CATEGORY_TO_TYPE[filter],
        );
        if (cancelled) return;
        if (items.length === 0) {
          // 真实池完全没有内容时才展示示例；已有真实愿签但当前分类为空，则如实显示空分类。
          setPosts(serverSeen.current ? [] : samplePosts);
        } else {
          serverSeen.current = true;
          setPosts(
            items.map((post) => ({
              id: post.id,
              name: post.relation,
              category: categoryLabel(post.category),
              text: post.excerpt,
              author: post.display_label,
              source: 'server' as const,
            })),
          );
        }
      } catch (e) {
        if (!cancelled) {
          setPosts(samplePosts);
          setError((e as Error).message || '愿签池暂时无法加载。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, isDemo]);

  async function open(post: PoolPostView) {
    setSelected(post);
    setReply('');
    setError('');
    if (post.source === 'server') {
      try {
        const result = await actions.getPost(post.id);
        setServerReplies(result.replies);
      } catch (e) {
        setError((e as Error).message || '这封愿签暂时不可见。');
        setServerReplies([]);
      }
    }
  }

  const shown = posts.filter((post) => filter === '全部' || post.category === filter);

  return (
    <div className="page">
      <Heading
        eyebrow="WISHES ON THE WATER"
        title="原来，大家都有放在心上的人"
        description="看看水面上的愿签，也给别人的牵挂留一点温柔。"
      />
      <div className="pool-banner">
        <Mail size={36} />
        <p>
          每一封漂来的信，
          <br />
          <strong>都藏着一个被认真惦记的人。</strong>
        </p>
        <span className="tag">{usingServer ? '真实愿签 · 匿名发布' : '示例愿签 · 本机预览'}</span>
      </div>
      <div className="filters" aria-label="愿望分类">
        {filters.map((category) => (
          <button
            className={filter === category ? 'selected' : ''}
            key={category}
            aria-pressed={filter === category}
            onClick={() => setFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>
      {loading && <p className="muted">正在从愿签池取信…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loading && shown.length === 0 && (
        <p className="muted">这个分类还没有公开的愿签，换个分类看看，或者先完成自己的约定。</p>
      )}
      <div className="pool-grid">
        {shown.map((post) => (
          <Paper key={post.id}>
            <span className="tag">{post.category}</span>
            <h2>替{post.name}许愿</h2>
            <p>{post.text}</p>
            <div className="pool-author">
              <span>{post.author}</span>
              <Mail size={17} />
            </div>
            <button className="secondary full" onClick={() => void open(post)}>
              读一读这份心意
            </button>
          </Paper>
        ))}
      </div>
      {selected && (
        <PoolDialog title={`替${selected.name}许愿`} close={() => setSelected(null)}>
          <p className="letter-text">{selected.text}</p>
          <span className="tag">
            {selected.source === 'server'
              ? '来自公开愿签池 · 匿名发布'
              : '示例内容 · 回信仅保存在本机'}
          </span>
          {selected.source === 'server'
            ? serverReplies.map((item) => (
                <p className="reply" key={item.id}>
                  {item.content}
                </p>
              ))
            : (data.replies[selected.id] || []).map((item, index) => (
                <p className="reply" key={index}>
                  {item}
                </p>
              ))}
          <label>
            留一句温柔的话
            <textarea
              maxLength={80}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
            />
          </label>
          <div className="field-meta">
            <span>
              {selected.source === 'server' ? '回信会公开给其他读者' : '不会发送给真实用户'}
            </span>
            <span>{reply.length}/80</span>
          </div>
          <button
            className="primary"
            disabled={!reply.trim()}
            onClick={async () => {
              try {
                if (selected.source === 'server') {
                  await actions.replyToPost(selected.id, reply.trim());
                  const result = await actions.getPost(selected.id);
                  setServerReplies(result.replies);
                  notify('回信已寄到愿签池。');
                } else {
                  await update((d) => ({
                    ...d,
                    replies: {
                      ...d.replies,
                      [selected.id]: [...(d.replies[selected.id] || []), reply.trim()],
                    },
                  }));
                  notify('回信已在本机收好。');
                }
                setReply('');
              } catch (e) {
                notify((e as Error).message || '保存失败，请重试。');
              }
            }}
          >
            收好这句话
          </button>
        </PoolDialog>
      )}
    </div>
  );
}

function PoolDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const element = document.activeElement as HTMLElement;
    return () => element?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-body">
        <button autoFocus className="icon-button close-dialog" aria-label="关闭" onClick={close}>
          <X />
        </button>
        <h2 id="dialog-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
