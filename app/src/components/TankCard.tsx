import type { PlayerState } from '@ttt/engine';

interface TankCardProps {
  player: PlayerState;
  isMe: boolean;
  onTap?: () => void;
}

// Compact stat card: HP / AP / range, tap to select as target.
export default function TankCard({ player, isMe, onTap }: TankCardProps) {
  return (
    <button className="tank-card" data-testid={`card-${player.id}`} onClick={onTap}>
      <span className="tank-card-name">
        {isMe ? `${player.name} (you)` : player.name}
        {player.isBot ? ' 🤖' : ''}
        {player.hp <= 0 ? ' ☠️' : ''}
      </span>
      <span className="tank-card-stats">
        ❤️ {player.hp} · ⚡ {player.ap} · 🎯 {player.range}
      </span>
    </button>
  );
}
