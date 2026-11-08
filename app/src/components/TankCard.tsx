import type { PlayerState } from '@ttt/engine';
import { Icon, heartSvg, boltSvg, targetSvg, robotSvg, skullSvg } from '../lib/icons';

interface TankCardProps {
  player: PlayerState;
  isMe: boolean;
  onTap?: () => void;
}

// Compact stat card: HP / AP / range, tap to select as target.
// Emojis replaced with inline SVG icons.
export default function TankCard({ player, isMe, onTap }: TankCardProps) {
  return (
    <button className="tank-card" data-testid={`card-${player.id}`} onClick={onTap}>
      <span className="tank-card-name">
        {isMe ? `${player.name} (you)` : player.name}
        {player.isBot && <Icon html={robotSvg} className="tank-card-icon" width={13} height={13} />}
        {player.hp <= 0 && <Icon html={skullSvg} className="tank-card-icon" width={13} height={13} />}
      </span>
      <span className="tank-card-stats">
        <Icon html={heartSvg} className="tank-card-icon" width={13} height={13} /> {player.hp} &middot;
        <Icon html={boltSvg} className="tank-card-icon" width={13} height={13} /> {player.ap} &middot;
        <Icon html={targetSvg} className="tank-card-icon" width={13} height={13} /> {player.range}
      </span>
    </button>
  );
}
