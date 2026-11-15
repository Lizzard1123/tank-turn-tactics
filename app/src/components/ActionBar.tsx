import { useState } from 'react';
import { type GameState, type ActionType } from '@ttt/engine';
import type { BoardMode } from './Board';

interface ActionBarProps {
  state: GameState;
  me: string;
  mode: BoardMode;
  onAction: (type: ActionType, payload: Record<string, unknown>) => void;
  onModeChange: (mode: BoardMode) => void;
}

// Action buttons for the local player. Every button only arms or cancels a
// mode (the board then highlights the legal targets); the player's own board
// tap picks the target and opens the confirmation. The buttons never choose
// or filter a target, and never trigger an action by themselves — except
// Upgrade Range, which has no target to choose.
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

  // heart gifts cost 1 of the GIVER's hp (never the last one)
  const canGiveHeart = mode === 'give_heart' || mine.hp >= 2;

  // Active-mode buttons stay clickable so a second click cancels the mode —
  // even when no target is in range.
  const canAttack = mode === 'attack' || ap >= cost;
  const canGive = mode === 'give_ap' || ap >= cost;
  const canUpgrade = ap >= state.config.upgradeCost;

  // Buttons ONLY arm or cancel a mode — they never pick a target and never
  // open a confirmation. The confirm dialog appears solely from the player's
  // own board tap (which cell to move to, which person to hit, who gets AP,
  // who gets a heart / rez), so the buttons can never act on anyone the
  // player did not explicitly choose.
  function handleAttack() {
    onModeChange(mode === 'attack' ? 'none' : 'attack');
  }
  function handleGive() {
    onModeChange(mode === 'give_ap' ? 'none' : 'give_ap');
  }
  function handleGiveHeart() {
    onModeChange(mode === 'give_heart' ? 'none' : 'give_heart');
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

