import type { GameState } from '@ttt/engine';

interface ReviveChooserProps {
  deadIds: string[] | null;
  players: GameState['players'];
  onPick: (targetId: string) => void;
  onClose: () => void;
}

// Popup shown when tapping a square with 2+ graves in give_heart mode:
// choose which dead player gets revived. Larger than the confirm dialog —
// each row carries the grave owner's tiny portrait, name and hp slot, so
// variable-length names stay readable.
export default function ReviveChooser({ deadIds, players, onPick, onClose }: ReviveChooserProps) {
  if (!deadIds || deadIds.length === 0) return null;
  return (
    <div className="confirm-overlay" data-testid="revive-chooser" onClick={onClose}>
      <div className="confirm-dialog revive-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>WHO GETS REVIVED?</h2>
        <div className="revive-options">
          {deadIds.map((id) => {
            const p = players[id];
            if (!p) return null;
            return (
              <button
                key={id}
                type="button"
                className="revive-option"
                data-testid={`revive-option-${id}`}
                onClick={() => onPick(id)}
              >
                <span className="revive-name">{p.name}</span>
                <span className="revive-sub">revive with a heart</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="revive-cancel" data-testid="revive-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
