import type { RefObject } from 'react';
import type { EasterEggView } from '../domain';
import { PixelIcon } from '../PixelIcon';
import './EggNotice.css';

const themes = {
  visit: { icon: 'ticket', design: 'ticket' },
  company: { icon: 'cup', design: 'invitation' },
  health: { icon: 'leaf', design: 'care' },
  heart: { icon: 'heart', design: 'stationery' },
  life: { icon: 'gift', design: 'parcel' },
  default: { icon: 'mail', design: 'stationery' },
} as const;

export function yuan(cents: number) {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function EggNotice({
  egg,
  titleRef,
  titleLevel = 2,
  className = '',
}: {
  egg: Pick<
    EasterEggView,
    | 'title'
    | 'summary'
    | 'plan_steps'
    | 'cost_min_cents'
    | 'cost_max_cents'
    | 'affordable'
    | 'gap_cents'
    | 'closing'
    | 'ai_label'
  > & { direction?: string };
  titleRef?: RefObject<HTMLHeadingElement | null>;
  titleLevel?: 1 | 2;
  className?: string;
}) {
  const direction = egg.direction;
  const theme =
    direction && Object.hasOwn(themes, direction)
      ? themes[direction as keyof typeof themes]
      : themes.default;
  const Title = titleLevel === 1 ? 'h1' : 'h2';

  return (
    <article className={`egg-notice egg-notice-${theme.design} ${className}`}>
      <div className="egg-notice-mark">
        <PixelIcon name={theme.icon} size={43} />
      </div>
      <span className="egg-notice-label">{egg.ai_label}</span>
      <Title ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
        {egg.title}
      </Title>
      <p className="egg-notice-cost">
        参考 {yuan(egg.cost_min_cents)}–{yuan(egg.cost_max_cents).slice(1)}
        {' · '}
        {egg.affordable ? '现在已经够得着' : `还差 ${yuan(egg.gap_cents)}`}
      </p>
      <p>{egg.summary}</p>
      <ol>
        {egg.plan_steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      <p className="egg-notice-closing">{egg.closing}</p>
    </article>
  );
}
