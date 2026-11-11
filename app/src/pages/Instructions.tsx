import { Link } from 'react-router-dom';
import { Icon, heartSvg, boltSvg, targetSvg } from '../lib/icons';

// Info-page graphics, drawn in the field-operations design system
// (khaki stock, olive-drab grid, ink outlines, signal-orange accents).
// The standalone SVG sources live in docs/graphics/.

function BoardOutline() {
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" aria-label="8x8 tactical board">
      <rect width="200" height="200" fill="#e9e2cf" />
      <defs>
        <pattern id="ttt-grid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M25 0V200 M0 25H200" stroke="#6b6a4f" stroke-width="1" />
        </pattern>
      </defs>
      <rect width="200" height="200" fill="url(#ttt-grid)" />
      <rect width="200" height="200" fill="none" stroke="#26251d" stroke-width="3" />
    </svg>
  );
}

function TankIcon() {
  return (
    <svg width="160" height="130" viewBox="0 0 160 130" aria-label="Tank">
      <circle cx="80" cy="64" r="30" fill="#c8471f" stroke="#26251d" stroke-width="3" />
      <rect x="68" y="46" width="24" height="18" fill="#c8471f" stroke="#26251d" stroke-width="2" rx="2" />
      <rect x="46" y="82" width="68" height="12" fill="none" stroke="#26251d" stroke-width="2" />
      <text
        x="80"
        y="71"
        textAnchor="middle"
        fill="#e9e2cf"
        fontFamily="'Black Ops One', sans-serif"
        fontSize="22"
        fontWeight="700"
      >
        T
      </text>
    </svg>
  );
}

function APIcon() {
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" aria-label="Action points (AP)">
      <circle cx="70" cy="70" r="32" fill="#a07a1e" stroke="#26251d" stroke-width="3" />
      <text
        x="70"
        y="78"
        textAnchor="middle"
        fill="#e9e2cf"
        fontFamily="'Black Ops One', sans-serif"
        fontSize="26"
        fontWeight="700"
        letterSpacing="2"
      >
        AP
      </text>
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="140" height="130" viewBox="0 0 140 130" aria-label="Flag marker">
      <line x1="62" y1="32" x2="62" y2="108" stroke="#26251d" strokeWidth="4" strokeLinecap="round" />
      <rect x="62" y="42" width="44" height="30" fill="#c8471f" stroke="#26251d" stroke-width="2" />
    </svg>
  );
}

function HeartGraphic() {
  return (
    <svg width="120" height="110" viewBox="0 0 120 110" aria-label="Heart pickup">
      <rect width="120" height="110" fill="#e9e2cf" stroke="#26251d" stroke-width="3" />
      <path
        d="M60 88 C 30 66, 22 44, 38 30 C 48 22, 60 30, 60 40 C 60 30, 72 22, 82 30 C 98 44, 90 66, 60 88 Z"
        fill="#c8471f" stroke="#26251d" stroke-width="3"
      />
    </svg>
  );
}

function Figure({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <figure className="graphic" style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {children}
      {caption && (
        <figcaption style={{ fontSize: '0.8rem', color: 'var(--olive)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export default function Instructions() {
  return (
    <main className="instructions">
      <Link to="/" className="muted">← Back</Link>
      <h1>How to play</h1>

      <div className="panel">
        <div className="panel-body">
          <h2>Goal</h2>
          <p>Be the last tank standing. Attack others, form alliances, give
          (and take) Action Points — and outsmart everyone with superior
          group strategy.</p>
        </div>
        <Figure caption="The battlefield — an 8×8 cell tactical map">
          <BoardOutline />
        </Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Stats</h2>
          <p><Icon html={heartSvg} width={14} height={14} className="stat-icon" /> <strong>Health (HP)</strong> — starts at 3. Never heals. At 0,
          you die and join the Jury.</p>
          <p><Icon html={boltSvg} width={14} height={14} className="stat-icon" /> <strong>Action Points (AP)</strong> — used for everything.
          Everyone starts at 4 and gains AP every day.</p>
          <p><Icon html={targetSvg} width={14} height={14} className="stat-icon" /> <strong>Range</strong> — the distance (in grid steps) at which
          you can interact with other players. Starts at 2.</p>
        </div>
        <div className="graphic-row">
          <Figure caption="Tank"><TankIcon /></Figure>
          <Figure caption="Action points"><APIcon /></Figure>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Actions (cost AP)</h2>
          <p><strong>Move</strong> — 1 square (no diagonals) per 1 AP.</p>
          <p><strong>Attack</strong> — 1 HP damage to a player in range, per 1 AP.</p>
          <p><strong>Give AP</strong> — transfer 1 AP to a player in range, per 1 AP.</p>
          <p><strong>Upgrade Range</strong> — +1 range per 2 AP.</p>
        </div>
        <Figure caption="Tank — 1 square per AP"><TankIcon /></Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>The Day Cycle</h2>
          <p>Once per day, every alive player receives 1 AP. Dead players
          can't act — but they can vote.</p>
        </div>
        <Figure caption="Action points — gained once per day"><APIcon /></Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>AP schedules (host-configurable)</h2>
          <p>How AP lands on the board depends on the game's schedule:</p>
          <p><strong>Fixed interval</strong> — AP drips every N minutes from
          the moment the game starts. The countdown shows the next grant.</p>
          <p><strong>Daily at a fixed time</strong> — AP lands once per day at
          a fixed wall-clock time in the configured timezone (work-days
          style). The countdown shows time until that slot.</p>
          <p><strong>Random time within a period</strong> — the day is split
          into periods (e.g. every 6 hours); AP lands once per period at a
          secret random minute. There is <strong>no countdown</strong> in this
          mode — stay ready, and don't assume anyone else's AP either.</p>
          <p><strong>AP is secret</strong> — hoard it, spend it, or gift it;
          only your own stash is visible to you.</p>
        </div>
        <Figure caption="Action points — three ways to receive them"><APIcon /></Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Heart spawns (host-configurable)</h2>
          <p>Game hosts can enable collectible hearts that appear on the board
          on their own schedule (fixed interval, daily time, or a secret random
          minute inside a period — spawn times are never shown).</p>
          <p><strong>Claiming:</strong> move onto a heart to pick it up —
          +1 HP, capped at your starting HP. A new spawn replaces an unclaimed
          heart.</p>
          <p><strong>Placement:</strong> <em>Random</em> scatters hearts
          anywhere free; <em>Smart</em> places each heart as far away from
          every living player (and the previous heart) as possible — expect a
          hike.</p>
        </div>
        <Figure caption="Hearts — find them, claim them"><HeartGraphic /></Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Heart gifts &amp; revives (host-configurable)</h2>
          <p>When heart gifts are enabled, you can <strong>give a heart</strong>
          to a player in range. It costs <strong>1 of YOUR hearts</strong> (you
          always keep at least one) — never AP.</p>
          <p><strong>Heal:</strong> a living ally below max HP gains 1 HP.</p>
          <p><strong>Revive:</strong> if revives are enabled, giving a heart
          to a <em>dead</em> player brings them back at <strong>1 HP / 0
          AP</strong>, straight off the jury. Dead players with revives on see
          no board and no event log — just the jury vote and a long wait for
          someone to care.</p>
        </div>
        <Figure caption="Hearts — give them, receive them"><HeartGraphic /></Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Blood money &amp; haunted tanks (host-configurable)</h2>
          <p><strong>Steal AP on kill:</strong> with this rule on, the final
          blow transfers the victim's entire AP stash to their killer. Off,
          a dead player's AP dies with them. Choose your assassinations by
          the loot.</p>
          <p><strong>Jury haunt:</strong> the jury's most-voted living player
          is <em>haunted</em> for the day — they receive no AP on the next
          tick. A tie haunts nobody; the 3-vote jury bonus still applies to
          the haunted player. Vote carefully.</p>
          <p><strong>Gravestones:</strong> dead tanks stay on the board as
          gravestones with their name on them. Graves don't block movement —
          drive right over them (and hearts can spawn beside them).</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Battle log</h2>
          <p>During a game the live battle log only shows what matters:
          <strong> who dealt a final blow</strong> and <strong>who got
          revived</strong>. The full event history unlocks after the game
          ends (test-mode hosts can scrub and fork it anytime).</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>The Jury</h2>
          <p>When a player dies, they join the Jury. The Jury votes every day;
          any living player with 3+ votes receives 1 bonus AP. Don't make
          enemies on your way out.</p>
        </div>
        <Figure caption="Flag marker"><FlagIcon /></Figure>
      </div>

      <div className="panel">
        <div className="panel-body">
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
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2>Winning</h2>
          <p>Survive to the end and win. Alliances burn bright and betrayals
          burn deeper — trust carefully.</p>
        </div>
      </div>
    </main>
  );
}
