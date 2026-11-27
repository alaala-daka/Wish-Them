import { useRef } from 'react';
import { go, Mascot, PrivateNote, TourPopup } from '../components';
import { PixelIcon } from '../PixelIcon';
import type { Props } from './types';
import './Home.css';

const steps = [
  { icon: 'mail', title: '写下心愿' },
  { icon: 'check', title: '做今天的小事' },
  { icon: 'leaf', title: '把心意带到现实' },
] as const;

export function Home({ data }: Props) {
  const hasActiveWish = data.wish && data.wish.status !== 'settled';
  const homeAction = useRef<HTMLButtonElement>(null);

  return (
    <div className="home postoffice-home">
      <div className="postoffice-board">
        <div className="postoffice-hangers" aria-hidden="true">
          <i />
          <i />
        </div>
        <section className="postoffice-letter">
          <div className="postoffice-ornament">
            <span aria-hidden="true">◆</span> 暖木愿望邮局 <span aria-hidden="true">◆</span>
          </div>
          <h1>
            有些话说不出口，
            <br />
            就替TA许个愿。
          </h1>
          <p>把心意写下来，从今天的一件小事开始。</p>
          <button
            ref={homeAction}
            className="primary postoffice-action"
            onClick={() => go(hasActiveWish ? '/today' : '/start')}
          >
            {hasActiveWish ? '继续今天的小事' : data.wish ? '再许一个愿' : '替TA许个愿'}
          </button>
          <button className="secondary postoffice-pool" onClick={() => go('/pool')}>
            看看大家的愿望
          </button>
          <PrivateNote />
        </section>
      </div>
      <TourPopup homeAction={homeAction} />
      <div className="postoffice-character">
        <Mascot message="这句话，我替你好好收着。" />
        <div className="postoffice-sign">
          <strong>替妈妈许愿</strong>
          <span>希望妈妈每天都睡得好一点。</span>
          <PixelIcon name="heart" size={16} />
        </div>
      </div>
      <ol className="postoffice-steps" aria-label="邮局流程">
        {steps.map(({ icon, title }) => (
          <li key={icon}>
            <PixelIcon name={icon} size={42} />
            <strong>{title}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
