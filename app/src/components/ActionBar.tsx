import { type GameState, type ActionType } from '@ttt/engine';
import { inRange } from '@ttt/engine';
import type { BoardMode } from './Board';

interface ActionBarProps {
  state: GameState;
  me: string;
  mode: BoardMode;
  onAction: (type: ActionType, payload: Record<string, unknown>) => void;
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

  // AP icon tint from the jury: golden when you received the bonus vote AP,
  // purple when the jury haunted you (you lost that tick's drip). Each shows
  // only on the day AFTER the vote was tallied — lastBonus carries the tick's
  // day, and `haunted` is cleared/replaced by the next tick.
  const bonusMine = (state.lastBonus ?? []).find((b) => b.id === me && b.day === state.day);
  const apTint = state.haunted === me ? 'purple' : bonusMine ? 'golden' : null;

  // find a target for attack/give in the current mode (living players only:
  // give_ap to a dead player is rejected server-side with "player is dead")
  const targetId = Object.values(state.players).find(
    (p) => p.id !== me && p.hp > 0 && inRange(mine.pos, p.pos, mine.range)
      && (mode !== 'attack' || p.hp > 0),
  )?.id ?? null;

  // Active-mode buttons stay clickable so a second click toggles them off —
  // even when no target is in range (that click then just unselects).
  const canAttack = mode === 'attack' || ap >= cost;
  const canGive = mode === 'give_ap' || ap >= cost;
  const canUpgrade = ap >= state.config.upgradeCost;

  // heart gifts cost 1 of the GIVER's hp (never the last one); targets are
  // allies under max hp, or graves when revives are on
  const heartTarget = Object.values(state.players).find(
    (p) => p.id !== me && inRange(mine.pos, p.pos, mine.range)
      && (p.hp > 0 ? p.hp < state.config.startingHp : !!state.config.revives),
  )?.id ?? null;
  const canGiveHeart = mode === 'give_heart' || mine.hp >= 2;

  function handleAttack() {
    if (mode === 'attack') {
      // toggle off: clicking the active button unselects it (also when no
      // target is in range, since the button stays enabled in active mode)
      if (!targetId || ap < cost) onModeChange('none');
      else onAction('attack', { targetId });
    } else onModeChange('attack');
  }
  function handleGive() {
    if (mode === 'give_ap') {
      if (!targetId || ap < cost) onModeChange('none');
      else onAction('give_ap', { targetId, amount: 1 });
    } else onModeChange('give_ap');
  }
  function handleGiveHeart() {
    if (mode === 'give_heart') {
      if (!heartTarget || mine.hp < 2) onModeChange('none');
      else onAction('give_heart', { targetId: heartTarget });
    } else onModeChange('give_heart');
  }
  function handleMove() {
    onModeChange(mode === 'move' ? 'none' : 'move');
  }

  return (
    <div className="action-bar" data-testid="action-bar">
      <span
        className={`ap-counter${apTint ? ` ap-${apTint}` : ''}`}
        data-testid="ap-counter"
        {...(apTint ? { 'data-ap-tint': apTint } : {})}
      >
        {ap} AP{apTint === 'golden' ? ' ★' : apTint === 'purple' ? ' ☾' : ''}
      </span>
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
      {state.config.heartGifts && (
        <button
          data-testid="btn-give-heart"
          disabled={!canGiveHeart}
          onClick={handleGiveHeart}
          className={mode === 'give_heart' ? 'active' : ''}
        >
          Give Heart <small>1 HP</small>
        </button>
      )}
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

