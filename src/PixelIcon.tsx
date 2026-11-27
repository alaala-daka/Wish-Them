import { useLayoutEffect, useRef } from 'react';

// Each character paints one square on a 12-pixel grid. The icon can scale with
// the control that contains it, without a font or an image request.
const palette = {
  o: '#532b21',
  p: '#fff0c8',
  g: '#e9a752',
  r: '#b8402d',
  s: '#667848',
  b: '#55768f',
  w: '#fffaf0',
};

const glyphs = {
  mail: [
    'oooooooooooo',
    'oppppppppppo',
    'oogppppppgoo',
    'opogppppgopo',
    'oppogppgoppo',
    'oppporropppo',
    'oppgorrogppo',
    'opgppppppgpo',
    'ogppppppppgo',
    'oooooooooooo',
  ],
  sun: [
    '.....gg.....',
    '..g..gg..g..',
    '...g....g...',
    '....gggg....',
    'g..gppppg..g',
    'gg.gppppg.gg',
    'gg.gppppg.gg',
    'g..gppppg..g',
    '....gggg....',
    '...g....g...',
    '..g..gg..g..',
    '.....gg.....',
  ],
  wave: [
    '............',
    '...bb....bb.',
    'b.bb.b..bb.b',
    'bb...bbbb...',
    '............',
    '...bb....bb.',
    'b.bb.b..bb.b',
    'bb...bbbb...',
    '............',
    '...bb....bb.',
    'b.bb.b..bb.b',
    'bb...bbbb...',
  ],
  book: [
    '............',
    '.oooo.oooo.',
    'o.pppoppp.o',
    'opgppoppgpo',
    'oppgpogpppo',
    'opgppoppgpo',
    'oppgpogpppo',
    'oppppoppppo',
    'oooooo.oooo',
    '.....oo.....',
  ],
  person: [
    '....oooo....',
    '...oggggo...',
    '...ogppgo...',
    '...oppgpo...',
    '....oooo....',
    '............',
    '...oooooo...',
    '..orrrrro...',
    '.orrrrrrro..',
    '.ooooooooo..',
  ],
  heart: [
    '............',
    '..ooo..ooo..',
    '.orrrroorro.',
    'orprrrrrrrro',
    'orrrrrrrrrro',
    '.orrrrrrrro.',
    '..orrrrrro..',
    '...orrrro...',
    '....orro....',
    '.....oo.....',
  ],
  leaf: [
    '.......oooo.',
    '......osssso',
    '.....ospssso',
    '.ooooosssso.',
    'ossssoosso..',
    'ospsoosoo...',
    '.osssoo.....',
    '..oooo......',
    '.....oo.....',
    '.....oo.....',
    '..oooooooo..',
    '...oooooo...',
  ],
  check: [
    '............',
    '.........ss.',
    '........sss.',
    '.......sss..',
    '......sss...',
    '.ss..sss....',
    '.ssssss.....',
    '..ssss......',
    '...ss.......',
    '............',
  ],
  camera: [
    '....oooo....',
    '...oggggo...',
    'oooooooooooo',
    'ogggggggggwo',
    'opppoooopppo',
    'opoobboopppo',
    'opobwwbopppo',
    'opobbbbopppo',
    'opoooooppppo',
    'oppppppppppo',
    'oooooooooooo',
  ],
  coin: [
    '....oooo....',
    '..ooggggoo..',
    '.oggggggggo.',
    '.ogppgggggo.',
    'ogpggogggggo',
    'ogpgopoggggo',
    'ogggopoggggo',
    'oggggogggggo',
    '.oggggggggo.',
    '.ooggggggoo.',
    '...oooooo...',
  ],
  gift: [
    '..oo....oo..',
    '.oroo..ooro.',
    '..orroorro..',
    'oooooooooooo',
    'oggggrrggggo',
    'oooooooooooo',
    '.ogggrrgggo.',
    '.ogggrrgggo.',
    '.ogggrrgggo.',
    '.ogggrrgggo.',
    '.oooooooooo.',
  ],
  ticket: [
    '............',
    '.oooooooooo.',
    'ogggpggggggo',
    'ogpgpgpppggo',
    '.gpgpgggggg.',
    '.gpgpgppggg.',
    'ogpgpggggggo',
    'ogggpggggggo',
    '.oooooooooo.',
    '............',
  ],
  lock: [
    '....oooo....',
    '...oggggo...',
    '...og..go...',
    '...og..go...',
    '..oooooooo..',
    '..oggggggo..',
    '..oggooggo..',
    '..oggooggo..',
    '..oggggggo..',
    '..oooooooo..',
  ],
  stamp: [
    '....oooo....',
    '...orrrro...',
    '...orrrro...',
    '....orro....',
    '....orro....',
    '....orro....',
    '..oooooooo..',
    '.orrrrrrrro.',
    'oooooooooooo',
    'oggggggggggo',
    'oooooooooooo',
  ],
  question: [
    '...oooooo...',
    '..oorrrroo..',
    '..or....ro..',
    '.......ro...',
    '......ro....',
    '.....ro.....',
    '.....ro.....',
    '............',
    '.....ro.....',
    '.....oo.....',
  ],
  cup: [
    '...g..g.....',
    '....g..g....',
    '............',
    '.oooooooo...',
    '.oggggggooo.',
    '.ospsssso.go.',
    '.osssssoogo.',
    '..ossssoo...',
    '...oooo.....',
    '.ooooooooo..',
    '..ooooooo...',
  ],
  pen: [
    '........ooo.',
    '.......ogwo.',
    '......ogwoo.',
    '.....ogwoo..',
    '....ogwoo...',
    '...ogwoo....',
    '..ogwoo.....',
    '..owoo......',
    '.ooo........',
    '.oo.........',
    '............',
  ],
} as const;

export type PixelIconName = keyof typeof glyphs;
type Color = keyof typeof palette;

export function PixelIcon({
  name,
  size = 24,
  className = '',
}: {
  name: PixelIconName;
  size?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const rows = glyphs[name];
    const offset = Math.floor((12 - rows.length) / 2);
    context.clearRect(0, 0, 12, 12);
    rows.forEach((row, y) => {
      Array.from(row).forEach((code, x) => {
        const fill = palette[code as Color];
        if (!fill) return;
        context.fillStyle = fill;
        context.fillRect(x, y + offset, 1, 1);
      });
    });
  }, [name]);
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className={`pixel-icon ${className}`}
      width={12}
      height={12}
      style={{ width: size, height: size }}
    />
  );
}
