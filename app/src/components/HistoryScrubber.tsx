import { useState } from 'react';
import type { GameEvent } from '@ttt/engine';

interface HistoryScrubberProps {
  events: GameEvent[];
  canFork: boolean;
  onFork: (toSeq: number) => void;
  onExit: () => void;
  onScrub: (seq: number) => void;
  // Recap replay: when provided, "Replay from here" animates the events
  // after the current scrub position (the parent drives the timer).
  onReplay?: () => void;
  replaying?: boolean;
  onStop?: () => void;
}

// Test-mode time machine: scrub through past event seqs; the creator can
// fork the game to any past point, and anyone can watch an animated replay.
export default function HistoryScrubber({
  events, canFork, onFork, onExit, onScrub, onReplay, replaying = false, onStop,
}: HistoryScrubberProps) {
  const [seq, setSeq] = useState(0);

  function change(value: string) {
    const n = parseInt(value, 10);
    setSeq(n);
    onScrub(n);
  }

  return (
    <section className="card" data-testid="history-scrubber" aria-label="History">
      <h2>History</h2>
      <p>Replaying event {seq} of {events.length}</p>
      <input
        type="range"
        min={0}
        max={events.length}
        value={seq}
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
          <button className="danger" disabled={seq === events.length} onClick={() => onFork(seq)}>
            Rewind to here
          </button>
        )}
      </div>
    </section>
  );
}
