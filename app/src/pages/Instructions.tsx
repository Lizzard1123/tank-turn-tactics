import { Link } from 'react-router-dom';

export default function Instructions() {
  return (
    <main className="instructions">
      <Link to="/" className="muted">← Back</Link>
      <h1>How to play</h1>

      <div className="panel">
        <h2>Goal</h2>
        <p>Be the last tank standing. Attack others, form alliances, give
        (and take) Action Points — and outsmart everyone with superior
        group strategy.</p>
      </div>

      <div className="panel">
        <h2>Stats</h2>
        <p><strong>❤️ Health (HP)</strong> — starts at 3. Never heals. At 0,
        you die and join the Jury.</p>
        <p><strong>⚡ Action Points (AP)</strong> — used for everything.
        Everyone starts at 0 and gains AP every day.</p>
        <p><strong>🎯 Range</strong> — the distance (in grid steps) at which
        you can interact with other players. Starts at 2.</p>
      </div>

      <div className="panel">
        <h2>Actions (cost AP)</h2>
        <p><strong>Move</strong> — 1 square (no diagonals) per 1 AP.</p>
        <p><strong>Attack</strong> — 1 HP damage to a player in range, per 1 AP.</p>
        <p><strong>Give AP</strong> — transfer 1 AP to a player in range, per 1 AP.</p>
        <p><strong>Upgrade Range</strong> — +1 range per 2 AP.</p>
      </div>

      <div className="panel">
        <h2>The Day Cycle</h2>
        <p>Once per day, every alive player receives 1 AP. Dead players
        can't act — but they can vote.</p>
      </div>

      <div className="panel">
        <h2>The Jury</h2>
        <p>When a player dies, they join the Jury. The Jury votes every day;
        any living player with 3+ votes receives 1 bonus AP. Don't make
        enemies on your way out.</p>
      </div>

      <div className="panel">
        <h2>Bots</h2>
        <p>Test-mode games fill empty seats with bots. Each living bot spends
        its Action Points during the AP drip, using planBotAction:</p>
        <p><strong>Easy:</strong> acts about 40% of the time. When it acts,
        it attacks a random in-range target half the time, otherwise moves to
        a random free square.</p>
        <p><strong>Medium:</strong> acts about 80% of the time. Attacks a
        random in-range target whenever one is present; otherwise sometimes
        upgrades range (30% chance when AP allows), else moves randomly.</p>
        <p><strong>Hard:</strong> acts about 95% of the time. Attacks the
        lowest-HP player in range, gives AP to a target when flush, upgrades
        range when AP allows, and otherwise moves toward the nearest player.</p>
        <p><strong>Bot AI is a placeholder.</strong> Current behavior is a
        simple deterministic stub — real bot AI will be designed later and is
        not part of this plan.</p>
      </div>

      <div className="panel">
        <h2>Winning</h2>
        <p>Survive to the end and win. Alliances burn bright and betrayals
        burn deeper — trust carefully.</p>
      </div>
    </main>
  );
}
