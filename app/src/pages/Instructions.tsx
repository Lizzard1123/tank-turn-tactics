import { Link } from 'react-router-dom';
import { Icon, heartSvg, boltSvg, targetSvg } from '../lib/icons';
import gameMobile from '../assets/screenshots/game-mobile.png';
import gameDesktop from '../assets/screenshots/game-desktop.png';
import dashboardMobile from '../assets/screenshots/dashboard-mobile.png';
import dashboardDesktop from '../assets/screenshots/dashboard-desktop.png';

// ---------------------------------------------------------------------------
// Info-page graphics — field-operations design system
// (khaki stock, olive-drab grid, ink outlines, signal-orange accents).
// The standalone SVG sources live in docs/graphics/.
// ---------------------------------------------------------------------------

function BoardOutline() {
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" aria-label="8x8 tactical board">
      <rect width="200" height="200" fill="#e9e2cf" />
      <defs>
        <pattern id="ttt-grid-inst" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M25 0V200 M0 25H200" stroke="#6b6a4f" stroke-width="1" />
        </pattern>
      </defs>
      <rect width="200" height="200" fill="url(#ttt-grid-inst)" />
      <rect width="200" height="200" fill="none" stroke="#26251d" stroke-width="3" />
    </svg>
  );
}

/** A flag marker — what players actually see on the board (avatars / flags). */
function FlagIcon() {
  return (
    <svg width="140" height="130" viewBox="0 0 140 130" aria-label="Flag marker — player token on the board">
      <line x1="62" y1="32" x2="62" y2="108" stroke="#26251d" strokeWidth="4" strokeLinecap="round" />
      <rect x="62" y="42" width="44" height="30" fill="#c8471f" stroke="#26251d" stroke-width="2" />
    </svg>
  );
}

function APIcon() {
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" aria-label="Action points (AP)">
      <circle cx="70" cy="70" r="32" fill="#a07a1e" stroke="#26251d" stroke-width="3" />
      <text
        x="70" y="78"
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

function HeartGraphic() {
  return (
    <svg width="220" height="110" viewBox="0 0 220 110" aria-label="Heart pickup — a flag moves onto an adjacent heart">
      <rect width="220" height="110" fill="#e9e2cf" stroke="#26251d" stroke-width="3" />
      {/* two board cells: the flag's square and the heart's square next door */}
      <line x1="110" y1="5" x2="110" y2="105" stroke="#6b6a4f" strokeWidth="1.5" />
      {/* your flag, parked in the left square */}
      <line x1="52" y1="42" x2="52" y2="88" stroke="#26251d" strokeWidth="3" strokeLinecap="round" />
      <rect x="52" y="50" width="30" height="20" fill="#c8471f" stroke="#26251d" strokeWidth="2" />
      {/* move arrow: one step onto the heart's square picks it up */}
      <line x1="84" y1="60" x2="118" y2="60" stroke="#26251d" strokeWidth="3" strokeDasharray="6 4" />
      <path d="M118 60 l-9 -5 v10 Z" fill="#26251d" />
      {/* the ration-token heart sitting in the neighbouring square */}
      <g transform="translate(116.8 15.4) scale(0.72)">
        <rect
          x="24" y="20" width="72" height="70" rx="12"
          fill="#f3ecdb" stroke="#26251d" strokeWidth="3"
        />
        <path
          d="M60 78 C 36 62, 30 46, 42 36 C 49 30, 60 36, 60 44 C 60 36, 71 30, 78 36 C 90 46, 84 62, 60 78 Z"
          fill="#c8471f" stroke="#26251d" strokeWidth="3"
        />
      </g>
    </svg>
  );
}

/** Mock action bar — what the player sees at the bottom of the game screen. */
function MockActionBar() {
  return (
    <div className="mock-action-bar" aria-label="Mock action bar">
      <button className="mock-ap-counter" aria-label="4 AP">4 AP</button>
      <button className="mock-btn" disabled>Move <small>1 AP</small></button>
      <button className="mock-btn">Attack <small>1 AP</small></button>
      <button className="mock-btn">Give AP <small>1 AP</small></button>
      <button className="mock-btn" disabled>Give Heart <small>1 HP</small></button>
      <button className="mock-btn" disabled>Upgrade Range <small>2 AP</small></button>
    </div>
  );
}

/** Mock battle log — collapsed by default on mobile. */
function MockBattleLog() {
  return (
    <div className="mock-battle-log" aria-label="Mock battle log">
      <div className="mock-battle-head">
        <span>Battle log</span>
        <span className="mock-chevron">▸</span>
      </div>
    </div>
  );
}

/** Mock AP info popup — shown when you tap the AP counter. */
function MockApPopup() {
  return (
    <div className="mock-popup" aria-label="Mock AP info popup">
      <div className="mock-popup-inner">
        <h3>Action Points</h3>
        <p>You have 4 AP. 12 have been given out in total.</p>
        <p className="mock-popup-note">
          <Icon html={boltSvg} width={12} height={12} className="mock-golden" />
          {' '}The jury awarded you bonus AP — your counter shines golden today.
        </p>
        <button>OK</button>
      </div>
    </div>
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
      <Link to="/" className="link-button btn">← Back</Link>
      <h1>How to play</h1>

      {/* ---- Goal ---------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Goal</h2>
          <p>Be the last flag standing. Attack others, form alliances, give
          (and take) Action Points — and outsmart everyone with superior
          group strategy.</p>
        </div>
        <Figure caption="The battlefield — an 8×8 cell tactical map">
          <BoardOutline />
        </Figure>
      </div>

      {/* ---- Stats ---------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Your stats</h2>
          <p><Icon html={heartSvg} width={14} height={14} className="stat-icon" />
          <strong>Health (HP)</strong> — starts at 3. You can only heal by
          picking up hearts on the board. At 0 HP you die and join the Jury.</p>
          <p><Icon html={boltSvg} width={14} height={14} className="stat-icon" /> <strong>Action Points (AP)</strong> — the resource to act
          with. Everyone starts with 0 AP and gains more each day.</p>
          <p><Icon html={targetSvg} width={14} height={14} className="stat-icon" /> <strong>Range</strong> — the distance (in grid steps) at which
          you can interact with other players. Starts at 2.</p>
        </div>
        <div className="graphic-row">
          <Figure caption="Player token — a flag on the board"><FlagIcon /></Figure>
          <Figure caption="Action points — spend to act"><APIcon /></Figure>
        </div>
      </div>

      {/* ---- Actions ------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Actions (cost AP)</h2>
          <table className="actions-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Cost</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Move</strong></td>
                <td>1 AP</td>
                <td>Shift 1 square (up / down / left / right). No diagonals.</td>
              </tr>
              <tr>
                <td><strong>Attack</strong></td>
                <td>1 AP</td>
                <td>Deal 1 damage to a player within your range.</td>
              </tr>
              <tr>
                <td><strong>Give AP</strong></td>
                <td>1 AP</td>
                <td>Transfer 1 AP to a player within your range.</td>
              </tr>
              <tr>
                <td><strong>Give Heart</strong></td>
                <td>1 of YOUR HP</td>
                <td>
                  Heal an ally below max HP by 1, or give a heart to any
                  player in range — living or dead.
                </td>
              </tr>
              <tr>
                <td><strong>Upgrade Range</strong></td>
                <td>2 AP</td>
                <td>+1 to your interaction range (in grid steps). Permanent.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Figure caption="Your action bar — arm a mode, then tap the board"><MockActionBar /></Figure>
      </div>

      {/* ---- Targeting ----------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>How targeting works</h2>
          <p>Buttons on the action bar <strong>only arm or cancel a mode</strong> —
          they never pick a target or confirm an action by themselves.</p>
          <p>After arming a mode, <strong>tap a cell on the board</strong> to
          choose your target. A confirmation dialog appears; press "Yes" to
          commit, "No" to cancel.</p>
          <ul>
            <li><strong>Move:</strong> tap an adjacent empty cell (or a gravestone — dead players don't block movement).</li>
            <li><strong>Attack / Give AP:</strong> tap an <em>alive</em> player in range.</li>
            <li><strong>Give Heart:</strong> tap any player in range — alive or dead.</li>
          </ul>
        </div>
      </div>

      {/* ---- AP Schedules -------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>How you receive AP</h2>
          <p>How AP lands on the board depends on the game's schedule —
          set by the host, not visible to players:</p>
          <p><strong>Fixed interval</strong> — AP drips every N minutes from
          the moment the game starts. The countdown shows the next grant.</p>
          <p><strong>Daily at a fixed time</strong> — AP lands once per day at
          a fixed wall-clock time in the configured timezone. The countdown
          shows time until that slot.</p>
          <p><strong>Random time within a period</strong> — the day is split
          into periods (e.g. every 6 hours); AP lands once per period at a
          secret random minute. There is <strong>no countdown</strong> in this
          mode — stay ready, and don't assume anyone else's AP either.</p>
          <p><strong>AP is secret</strong> — hoard it, spend it, or gift it;
          only your own stash is visible to you.</p>
          <p>Tap your AP counter to see a popup: your current AP, the lifetime
          total the game has granted you (all AP you've ever earned), and any
          jury tint explanation — why your counter is golden or purple.</p>
          <Figure caption="Tap the counter for details"><APIcon /></Figure>
        </div>
      </div>

      {/* ---- Heart Spawns -------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Heart spawns (host-configurable)</h2>
          <p>Game hosts can enable collectible hearts that appear on the board
          on their own schedule (fixed interval, daily time, or a secret random
          minute inside a period — spawn times are never shown). A configurable
          <strong> spawn delay</strong> keeps the early game heart-free: no
          hearts appear until the chosen time after the game starts.</p>
          <p><strong>Claiming:</strong> move onto a heart to pick it up —
          <strong> +1 HP</strong>, capped at your starting HP. At full HP the
          heart converts to <strong>+2 AP</strong> instead — a heart is never
          wasted.</p>
          <p><strong>Placement:</strong> <em>Random</em> scatters hearts
          anywhere free; <em>Smart</em> places each heart as far away from
          every living player (and the previous heart) as possible — expect a
          hike.</p>
          <p>Hosts can also cap how many unclaimed hearts sit on the board at
          once (default 1): once the cap is reached, new spawns wait until
          one is picked up.</p>
        </div>
        <Figure caption="Hearts — find them, claim them"><HeartGraphic /></Figure>
      </div>

      {/* ---- Heart Gifts & Revives ----------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Heart gifts &amp; revives (host-configurable)</h2>
          <p>When heart gifts are enabled, you can <strong>give a heart</strong>
          to a player in range. It costs <strong>1 of YOUR HP</strong> (you
          always keep at least one) — <em>never</em> AP.</p>
          <p><strong>Heal:</strong> a living ally below max HP gains 1 HP.</p>
          <p><strong>Revive:</strong> if revives are enabled, giving a heart
          to a <em>dead</em> player brings them back at <strong>1 HP / 0
          AP</strong>, straight off the jury. While dead you watch the board
          and vote daily — a heart from a teammate is your only way back.</p>
        </div>
        <Figure caption="Hearts — give them, receive them"><HeartGraphic /></Figure>
      </div>

      {/* ---- Special Rules ------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Special rules</h2>

          <h3>AP Steal on Kill</h3>
          <p>With this rule on, delivering the final blow transfers the
          victim's entire AP stash to you. Off, that AP is lost.
          Choose your assassinations by the loot.</p>

          <h3>Jury Haunt</h3>
          <p>The jury's most-voted living player is <em>haunted</em> — they
          receive no AP on the next tick. A tie for most votes haunts nobody.
          A player can be haunted and still receive the 3-vote bonus; the two
          effects are independent. Vote carefully.</p>

          <h3>Jury AP Tints</h3>
          <p>The day after the votes are tallied, your AP counter changes
          color so you know the jury's verdict:</p>
          <p>
            <span className="ap-counter ap-golden" style={{ display: 'inline-block' }}>4 AP</span>
            {' '}— you were the jury's favorite: 3+ votes landed you a bonus AP.
          </p>
          <p>
            <span className="ap-counter ap-purple" style={{ display: 'inline-block' }}>1 AP</span>
            {' '}— you are haunted: the jury withheld your AP drip for the day.
          </p>
          <p>Colors clear at the next day tick.</p>

          <h3>Gravestones</h3>
          <p>Dead flags stay on the board as gravestones — small tombstones
          with their name and a portrait. If several players die on the same
          square, each gets a smaller stone; up to 4 keep names, anything
          beyond that shows only a count tag. Graves <strong>don't block
          movement</strong> — drive right over them (and hearts can spawn
          beside them).</p>
        </div>
      </div>

      {/* ---- Battle Log ---------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Battle log</h2>
          <p>During a game the battle log only shows select key events:</p>
          <ul>
            <li><strong>Who dealt a final blow</strong> (shown as "dealt the final blow to …").</li>
            <li><strong>Who got revived</strong> (a heart brought someone back).</li>
          </ul>
          <p>The battle log is <strong>collapsed by default on mobile</strong>
          — tap the banner to expand it. On desktop it stays open.</p>
          <p>The full event history unlocks after the game
          ends (test-mode hosts can scrub it anytime).</p>
        </div>
        <Figure caption="Battle log — collapsed by default"><MockBattleLog /></Figure>
      </div>

      {/* ---- The Jury ------------------------------------------------------------ */}
      <div className="panel">
        <div className="panel-body">
          <h2>The Jury</h2>
          <p>When a player dies, their job changes: they join the Jury. From
          the jury screen you can watch the board and <strong>vote for a living
          player</strong> each day.</p>
          <p>Any living player with <strong>3 or more votes</strong> receives
          1 bonus AP on the next tick. You can change your vote at any
          time — and so can everyone else.</p>
          <p>Your votes are secret — no one can see who you voted for.</p>
          <p>Don't make enemies on your way out.</p>
        </div>
        <Figure caption="Flag marker — player token on the board"><FlagIcon /></Figure>
      </div>

      {/* ---- Screenshots --------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Screenshots</h2>
          <p>Here's what the game looks like in action — both on mobile and desktop.</p>
        </div>
        <div className="screenshot-gallery">
          <div className="screenshot-row">
            <figure className="screenshot-item screenshot-mobile">
              <img src={gameMobile} alt="Game board on mobile — grid with flag avatars and action bar" />
              <figcaption>Mobile game board</figcaption>
            </figure>
            <figure className="screenshot-item screenshot-desktop">
              <img src={gameDesktop} alt="Game board on desktop — grid with flag avatars and action bar" />
              <figcaption>Desktop game board</figcaption>
            </figure>
          </div>
          <div className="screenshot-row">
            <figure className="screenshot-item screenshot-mobile">
              <img src={dashboardMobile} alt="Mobile games dashboard — create and join games" />
              <figcaption>Mobile games dashboard</figcaption>
            </figure>
            <figure className="screenshot-item screenshot-desktop">
              <img src={dashboardDesktop} alt="Desktop games dashboard — create and join games" />
              <figcaption>Desktop games dashboard</figcaption>
            </figure>
          </div>
        </div>
      </div>

      {/* ---- Winning ------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-body">
          <h2>Winning</h2>
          <p>Be the last player alive and you win. Alliances burn bright and
          betrayals burn deeper — trust carefully.</p>
        </div>
      </div>
    </main>
  );
}
