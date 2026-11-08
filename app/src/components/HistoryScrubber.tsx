import type { GameEvent } from '@ttt/engine';

interface HistoryScrubberProps {
  events: GameEvent[];
  canFork: boolean;
  onFork: (toSeq: number) => void;
  onExit: () => void;
  onScrub: (seq: number) => void;
  // Parent-controlled scrub position: how many events are replayed.
  // Driven from outside so the slider tracks View clicks and replay steps.
  position: number;
  // Recap replay: when provided, "Replay from here" animates the events
  // after the current scrub position (the parent drives the timer).
  onReplay?: () => void;
  replaying?: boolean;
  onStop?: () => void;
}

// Test-mode time machine: scrub through past event seqs; the creator can
// fork the game to any past point, and anyone can watch an animated replay.
export default function HistoryScrubber({
  events, canFork, onFork, onExit, onScrub, position,
  onReplay, replaying = false, onStop,
}: HistoryScrubberProps) {
  function change(value: string) {
    onScrub(parseInt(value, 10));
  }

  return (
    <section className="card" data-testid="history-scrubber" aria-label="History">
      <h2>History</h2>
      <p>Replaying event {position} of {events.length}</p>
      <input
        type="range"
        min={0}
        max={events.length}
        value={position}
        onChange={(e) => change(e.target.value)}
        aria-label="history position"
      />
      <div className="scrubber-actions">
        <button onClick={onExit}>Back to live</button>
        {onReplay && !replaying && (
          <button onClick={onReplay} data-testid="replay-btn">Replay from here</button>
        )}
        {onReplay && replaying && (
          <button className="danger" onClick={onStop} data-testid="stop-replay-btn">Stop replay</button>
        )}
        {canFork && (
          <button className="danger" disabled={position === events.length} onClick={() => onFork(position)}>
            Rewind to here
          </button>
        )}
      </div>
    </section>
  );
}
