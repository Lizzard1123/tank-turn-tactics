import type { PlayerState } from '@ttt/engine';
import { Icon, heartSvg, targetSvg, robotSvg, skullSvg } from '../lib/icons';

interface TankCardProps {
  player: PlayerState;
  isMe: boolean;
  onTap?: () => void;
  // fog of war: jury voters in revives-on games see no HP/range intel
  hideStats?: boolean;
}

// Compact stat card. HP is public (damage/kills are visible); range is
// private — it's scrubbed to -1 on the wire for non-self players, so only
// your own card renders it (AP is private per video rules).
export default function TankCard({ player, isMe, onTap, hideStats }: TankCardProps) {
  return (
    <button className="tank-card" data-testid={`card-${player.id}`} onClick={onTap}>
      <span className="tank-card-name">
        {isMe ? `${player.name} (you)` : player.name}
        {player.isBot && <Icon html={robotSvg} className="tank-card-icon" width={13} height={13} />}
        {player.hp <= 0 && <Icon html={skullSvg} className="tank-card-icon" width={13} height={13} />}
      </span>
      {!hideStats && (
        <span className="tank-card-stats">
          <Icon html={heartSvg} className="tank-card-icon" width={13} height={13} /> {player.hp}
          {isMe && (
            <>
              {' '}&middot;
              <Icon html={targetSvg} className="tank-card-icon" width={13} height={13} /> {player.range}
            </>
          )}
        </span>
      )}
    </button>
  );
}
