import { Paper, go } from '../components';
import { PixelIcon } from '../PixelIcon';
export default function NoWish() {
  return (
    <Paper className="empty">
      <PixelIcon name="mail" size={48} />
      <h1>你的书桌，正等着一份心意</h1>
      <p>先替一个具体的人许愿，我们再从今天的小事开始。</p>
      <button className="primary" onClick={() => go('/start')}>
        写下第一张愿签
      </button>
    </Paper>
  );
}
