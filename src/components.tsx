import { ArrowRight, LockKeyhole, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Wish } from './domain';
import { PixelIcon } from './PixelIcon';
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
      <PixelIcon name="mail" size={29} />
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

export function TourPopup({ homeAction }: { homeAction: RefObject<HTMLButtonElement | null> }) {
  const [phase, setPhase] = useState<'open' | 'leaving' | 'closed'>('open');
  const [progress, setProgress] = useState(1);
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const card = useRef<HTMLElement>(null);
  const remaining = useRef(TOUR_POPUP_MS);

  const dismiss = useCallback(() => {
    if (card.current?.contains(document.activeElement)) {
      homeAction.current?.focus();
    }
    setPhase((current) => (current === 'open' ? 'leaving' : current));
  }, [homeAction]);

  useEffect(() => {
    if (phase !== 'open' || !card.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio >= 0.6),
      { threshold: 0.6 },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('closed'), 220);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open' || !visible || focused) return;
    let lastTick = performance.now();
    const resetTick = () => {
      lastTick = performance.now();
    };
    document.addEventListener('visibilitychange', resetTick);
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (document.hidden || card.current?.contains(document.activeElement)) {
        lastTick = now;
        return;
      }
      remaining.current = Math.max(0, remaining.current - (now - lastTick));
      lastTick = now;
      setProgress(remaining.current / TOUR_POPUP_MS);
      if (remaining.current <= 0) dismiss();
    }, 100);
    return () => {
      document.removeEventListener('visibilitychange', resetTick);
      window.clearInterval(timer);
    };
  }, [phase, visible, focused, dismiss]);

  useEffect(() => {
    if (phase !== 'open') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, dismiss]);

  if (phase === 'closed') return null;

  const openTour = () => {
    dismiss();
    go('/tour');
  };

  return (
    <aside
      ref={card}
      className={`postoffice-tour${phase === 'leaving' ? ' leaving' : ''}`}
      aria-labelledby="postoffice-tour-title"
      inert={phase === 'leaving'}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="postoffice-tour-head">
        <h2 id="postoffice-tour-title">流程速览</h2>
        <span className="postoffice-tour-postmark" aria-hidden="true">
          〰<br />〰<br />〰
        </span>
        <button
          type="button"
          className="postoffice-tour-close"
          aria-label="关闭流程速览"
          onClick={dismiss}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <p>三分钟，看完整段心意</p>
      <ol className="postoffice-tour-steps">
        <li>
          <PixelIcon name="mail" size={38} />
          许愿
        </li>
        <li>
          <PixelIcon name="check" size={38} />
          十天小事
        </li>
        <li>
          <PixelIcon name="coin" size={38} />
          攒钱
        </li>
        <li>
          <PixelIcon name="gift" size={38} />
          彩蛋
        </li>
      </ol>
      <button type="button" className="primary postoffice-tour-cta" onClick={openTour}>
        跟着小愿走一遍 <ArrowRight size={19} aria-hidden="true" />
      </button>
      <div className="postoffice-tour-count" aria-hidden="true">
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>
    </aside>
  );
}
