import { ArrowRight, Mail, LockKeyhole, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Wish } from './domain';
export const go = (path: string) => {
  window.location.hash = path;
  window.scrollTo(0, 0);
};
export function Mascot({
  message = '慢慢来，心意会被好好收下。',
  small = false,
}: {
  message?: string;
  small?: boolean;
}) {
  return (
    <div className={`mascot ${small ? 'small' : ''}`}>
      <p className="speech">{message}</p>
      <img src="/assets/xiaoyuan.png" alt="小愿，穿砖红背带裙、拿着信封的邮局女孩" />
    </div>
  );
}
export function Paper({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`paper ${className}`}>{children}</section>;
}
export function WishCard({ wish }: { wish: Pick<Wish, 'name' | 'text' | 'ai'> }) {
  return (
    <div className="wish-card">
      <Mail size={28} aria-hidden="true" />
      <span className="eyebrow">一封认真收藏的心意</span>
      <h2>替{wish.name}许愿</h2>
      <p>{wish.text}</p>
      {wish.ai && (
        <span className="tag">
          <Sparkles size={13} /> AI辅助
        </span>
      )}
      <div className="wish-sign">愿每一份心意，都慢慢靠近。</div>
    </div>
  );
}
export function PrivateNote() {
  return (
    <span className="private">
      <LockKeyhole size={14} aria-hidden="true" /> 愿签默认私密，由你决定是否分享
    </span>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <span className="postmark">
        暖木邮局
        <br />
        心意已收好
      </span>
    </header>
  );
}

const TOUR_POPUP_MS = 10000;

export function TourPopup() {
  const [phase, setPhase] = useState<'open' | 'leaving' | 'closed'>('open');
  const [progress, setProgress] = useState(1);
  const remaining = useRef(TOUR_POPUP_MS);
  const lastTick = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setPhase((current) => (current === 'open' ? 'leaving' : current));
  }, []);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('closed'), 220);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    lastTick.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      remaining.current = Math.max(0, remaining.current - (now - (lastTick.current ?? now)));
      lastTick.current = now;
      setProgress(remaining.current / TOUR_POPUP_MS);
      if (remaining.current <= 0) dismiss();
    }, 100);
    return () => {
      window.clearInterval(timer);
      lastTick.current = null;
    };
  }, [phase, dismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  if (phase === 'closed') return null;

  const openTour = () => {
    dismiss();
    go('/tour');
  };

  return (
    <aside
      className={`tour-pop${phase === 'leaving' ? ' leaving' : ''}`}
      aria-labelledby="tour-pop-title"
    >
      <div className="tour-pop-head">
        <span className="tour-pop-title" id="tour-pop-title">
          <Sparkles size={14} aria-hidden="true" /> 流程速览
        </span>
        <button
          type="button"
          className="tour-pop-close"
          aria-label="关闭流程速览"
          onClick={dismiss}
        >
          <X size={16} />
        </button>
      </div>
      <div className="tour-pop-body">
        <span className="tour-pop-avatar" aria-hidden="true">
          <img src="/assets/xiaoyuan.png" alt="" />
        </span>
        <div>
          <span className="eyebrow">A LITTLE TOUR</span>
          <h2>三分钟，看完整段心意</h2>
          <p>许愿、十天小事、攒下一点钱，再拆开最后的彩蛋。</p>
        </div>
      </div>
      <div className="tour-pop-steps" aria-hidden="true">
        <span>许愿</span>
        <b>›</b>
        <span>十天小事</span>
        <b>›</b>
        <span>攒钱</span>
        <b>›</b>
        <span>彩蛋</span>
      </div>
      <div className="tour-pop-foot">
        <button type="button" className="primary tour-pop-cta" onClick={openTour}>
          跟着小愿走一遍 <ArrowRight size={15} />
        </button>
      </div>
      <div className="tour-pop-count" aria-hidden="true">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </aside>
  );
}
