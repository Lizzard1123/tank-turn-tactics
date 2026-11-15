import { useState } from 'react';
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
  const [apInfoOpen, setApInfoOpen] = useState(false);
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
    <>
      <div className="action-bar" data-testid="action-bar">
      <button
        type="button"
        className={`ap-counter${apTint ? ` ap-${apTint}` : ''}`}
        data-testid="ap-counter"
        aria-haspopup="dialog"
        onClick={() => setApInfoOpen(true)}
        {...(apTint ? { 'data-ap-tint': apTint } : {})}
      >
        {ap} AP
      </button>
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

      {/* "Action Points" info popup: what you hold, the lifetime total the
          game has granted you, and — when the jury tinted your counter —
          why. Read-only: a single OK button dismisses it. Rendered OUTSIDE
          .action-bar so the bar's button rules can't bleed into it. */}
      {apInfoOpen && (
        <div
          className="confirm-overlay"
          data-testid="ap-info-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Action Points"
          onClick={() => setApInfoOpen(false)}
        >
          <div className="confirm-dialog" data-testid="ap-info-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 data-testid="ap-info-title">Action Points</h2>
            <p data-testid="ap-info-body">
              You have {ap} AP. {mine.apEarned ?? ap} have been given out in total.
            </p>
            {apTint === 'golden' && (
              <p data-testid="ap-info-tint">
                The jury awarded you bonus AP — your counter shines golden today.
              </p>
            )}
            {apTint === 'purple' && (
              <p data-testid="ap-info-tint">
                The jury haunted you — today&apos;s AP drip was withheld.
              </p>
            )}
            <div className="confirm-actions">
              <button data-testid="ap-info-ok" onClick={() => setApInfoOpen(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

