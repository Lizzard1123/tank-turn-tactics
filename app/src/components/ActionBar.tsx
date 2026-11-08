import { type GameState } from '@ttt/engine';
import { manhattan, inRange } from '@ttt/engine';
import type { BoardMode } from './Board';

interface ActionBarProps {
  state: GameState;
  me: string;
  mode: BoardMode;
  onAction: (type: string, payload: Record<string, unknown>) => void;
  onModeChange: (mode: BoardMode) => void;
}

// Action buttons for the local player. Move/attack/give are two-step:
// first tap selects a mode (board highlights legal targets), second tap
// (with a target in range) commits the action.
export default function ActionBar({ state, me, mode, onAction, onModeChange }: ActionBarProps) {
  const mine = state.players[me];
  if (!mine || mine.hp <= 0) return null;

  const ap = mine.ap;
  const cost = 1;

  // find a target for attack/give in the current mode
  const targetId = Object.values(state.players).find(
    (p) => p.id !== me && inRange(mine.pos, p.pos, mine.range)
      && (mode !== 'attack' || p.hp > 0),
  )?.id ?? null;

  const canAttack = ap >= cost && (mode !== 'attack' || targetId !== null);
  const canGive = ap >= cost && (mode !== 'give_ap' || targetId !== null);
  const canUpgrade = ap >= state.config.upgradeCost;

  function handleAttack() {
    if (mode === 'attack' && targetId) onAction('attack', { targetId });
    else onModeChange('attack');
  }
  function handleGive() {
    if (mode === 'give_ap' && targetId) onAction('give_ap', { targetId, amount: 1 });
    else onModeChange('give_ap');
  }
  function handleMove() {
    onModeChange(mode === 'move' ? 'none' : 'move');
  }

  return (
    <div className="action-bar" data-testid="action-bar">
      <span className="ap-counter" data-testid="ap-counter">{ap} AP</span>
      <button
        data-testid="btn-move"
        disabled={ap < cost}
        onClick={handleMove}
        className={mode === 'move' ? 'active' : ''}
      >
        Move <small>1 AP</small>
      </button>
      <button
        data-testid="btn-attack"
        disabled={!canAttack}
        onClick={handleAttack}
        className={mode === 'attack' ? 'active' : ''}
      >
        Attack <small>1 AP</small>
      </button>
      <button
        data-testid="btn-give"
        disabled={!canGive}
        onClick={handleGive}
        className={mode === 'give_ap' ? 'active' : ''}
      >
        Give AP <small>1 AP</small>
      </button>
      <button
        data-testid="btn-upgrade"
        disabled={!canUpgrade}
        onClick={() => onAction('upgrade_range', {})}
      >
        Upgrade Range <small>{state.config.upgradeCost} AP</small>
      </button>
    </div>
  );
}

// Manhattan helper re-exported for consumers (kept local to avoid API drift)
export { manhattan };
