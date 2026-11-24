import { Mail, ClipboardCheck, Sprout, Heart } from 'lucide-react';
import { go, Mascot, Paper, PrivateNote } from '../components';
import type { Props } from './types';

export function Home({ data }: Props) {
  return (
    <div className="home">
      <div className="home-scene">
        <div className="home-content">
          <Paper className="hero-paper">
            <span className="ornament">✦ 暖木愿望邮局 ✦</span>
            <h1>
              有些话说不出口，
              <br />
              就替TA许个愿。
            </h1>
            <p>
              把心意写下来，
              <br className="mobile-break" />
              从今天的一件小事开始。
            </p>
            <button
              className="primary hero-button"
              onClick={() => go(data.wish && data.wish.status !== 'settled' ? '/today' : '/start')}
            >
              {data.wish && data.wish.status !== 'settled'
                ? '继续今天的小事'
                : data.wish
                  ? '再许一个愿'
                  : '替TA许个愿'}
            </button>
            <button className="secondary" onClick={() => go('/pool')}>
              看看大家的愿望
            </button>
            <PrivateNote />
          </Paper>
          <div className="hero-character">
            <Mascot message="这句话，我替你好好收着。" />
            <div className="desk-sign">
              <strong>替妈妈许愿</strong>
              <span>
                希望妈妈每天
                <br />
                都睡得好一点。
              </span>
              <Heart size={18} />
            </div>
          </div>
        </div>
      </div>
      <div className="home-steps">
        {[
          [Mail, '写下心愿', '为重要的TA，写下你的心意。'],
          [ClipboardCheck, '做今天的小事', '为TA做一点，也照顾好自己。'],
          [Sprout, '把心意带到现实', '在一点一滴的行动里，让祝愿靠近。'],
        ].map(([Icon, title, desc]) => {
          const I = Icon as typeof Mail;
          return (
            <div key={String(title)}>
              <I size={35} strokeWidth={1.5} />
              <div>
                <h2>{String(title)}</h2>
                <p>{String(desc)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
