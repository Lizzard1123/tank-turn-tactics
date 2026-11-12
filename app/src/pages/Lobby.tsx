import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { gameGet, gameStart, gameUpdate, type GameDetail, type ScheduleMode } from '../lib/api';
import { Icon, robotSvg } from '../lib/icons';
import { ErrorScreen, Loading } from '../components/Status';

const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const SCHEDULE_MODES: { value: ScheduleMode; label: string }[] = [
  { value: 'interval', label: 'Fixed interval' },
  { value: 'timeOfDay', label: 'Daily at a fixed time' },
  { value: 'random', label: 'Random time within a period' },
];

export default function Lobby() {
  const { gameId } = useParams<{ gameId: string }>();
  const { token, player } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // editable knobs (test-mode lobby only)
  const [board, setBoard] = useState(8);
  const [startingHp, setStartingHp] = useState(3);
  const [startingAp, setStartingAp] = useState(4);
  const [baseRange, setBaseRange] = useState(2);
  const [apPerDay, setApPerDay] = useState(1);
  const [upgradeCost, setUpgradeCost] = useState(2);
  const [apIntervalMinutes, setApIntervalMinutes] = useState(5);
  const [bots, setBots] = useState<{ difficulty: 'easy' | 'medium' | 'hard' }[]>([]);
  // AP schedule shape + new-rule toggles
  const [apSchedule, setApSchedule] = useState<ScheduleMode>('interval');
  const [apPeriodMinutes, setApPeriodMinutes] = useState(360);
  const [apTimeOfDay, setApTimeOfDay] = useState('09:00');
  const [apTimezone, setApTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [apStealOnKill, setApStealOnKill] = useState(false);
  const [heartGifts, setHeartGifts] = useState(false);
  const [revives, setRevives] = useState(false);
  const [juryHaunt, setJuryHaunt] = useState(false);
  // heart spawns: independent schedule + placement
  const [heartSpawn, setHeartSpawn] = useState(false);
  const [heartSchedule, setHeartSchedule] = useState<ScheduleMode>('interval');
  const [heartIntervalMinutes, setHeartIntervalMinutes] = useState(120);
  const [heartTimeOfDay, setHeartTimeOfDay] = useState('12:00');
  const [heartTimezone, setHeartTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [heartPeriodMinutes, setHeartPeriodMinutes] = useState(360);
  const [heartSpawnDelayMinutes, setHeartSpawnDelayMinutes] = useState(0);
  const [heartCap, setHeartCap] = useState(1);
  const [heartPlacement, setHeartPlacement] = useState<'random' | 'smart'>('random');
  // display option: name plates on tank tiles (default on)
  const [showPlayerNames, setShowPlayerNames] = useState(true);

  const TZ_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (EST/EDT)' },
  { value: 'America/Chicago', label: 'Central (CST/CDT)' },
  { value: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'UTC', label: 'UTC' },
];

// Timezone picker: dropdown for the common US zones, plus a validated
// free-text "Other (IANA)…" entry for anywhere else.
function TzPicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [other, setOther] = useState(!TZ_OPTIONS.some((o) => o.value === value));
  const [draft, setDraft] = useState(value);
  const draftValid = draft === '' || isValidTz(draft);
  return (
    <>
      <select
        id={id}
        value={other ? '__other' : value}
        onChange={(e) => {
          if (e.target.value === '__other') {
            setOther(true);
            setDraft('');
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        {TZ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="__other">Other (IANA)…</option>
      </select>
      {other && (
        <>
          <label htmlFor={`${id}-tz`}>Timezone (IANA)</label>
          <input
            id={`${id}-tz`}
            type="text"
            value={draft}
            placeholder="e.g. Europe/Berlin"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (isValidTz(draft)) onChange(draft); }}
          />
          <span className="hint">{draft === '' ? 'Enter an IANA zone (e.g. Europe/Berlin)' : draftValid ? 'Valid IANA timezone' : 'Not a valid IANA timezone'}</span>
        </>
      )}
    </>
  );
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const isHost = detail?.game.createdBy === player?.id;


  // knobs sync from the server config ONCE — the 4s lobby poll re-runs load()
  // and must not clobber unsaved host edits (bots included: wiping the bots
  // the create flow added makes game-start reject with "need at least 2
  // players").
  const knobsLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!token || !gameId) return;
    try {
      const d = await gameGet(token, gameId);
      setDetail(d);
      if (!knobsLoaded.current && d.game.status === 'lobby' && d.game.createdBy === player?.id) {
        knobsLoaded.current = true;
        const c = d.game.config;
        setBoard(c.board);
        setStartingHp(c.startingHp);
        setStartingAp(c.startingAp);
        setBaseRange(c.baseRange);
        setApPerDay(c.apPerDay);
        setUpgradeCost(c.upgradeCost);
        setApIntervalMinutes(c.apIntervalMinutes ?? 5);
        setBots(c.bots ?? []);
        // legacy configs have no apSchedule: play games ran on the daily
        // time-of-day slot, test games on the interval drip
        setApSchedule(c.apSchedule ?? (c.apTimeOfDay ? 'timeOfDay' : d.game.mode === 'play' ? 'timeOfDay' : 'interval'));
        setApPeriodMinutes(c.apPeriodMinutes ?? 360);
        setApTimeOfDay(c.apTimeOfDay ?? '09:00');
        setApTimezone(c.apTimezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
        setApStealOnKill(!!c.apStealOnKill);
        setHeartGifts(!!c.heartGifts);
        setRevives(!!c.revives);
        setJuryHaunt(!!c.juryHaunt);
        setHeartSpawn(!!c.heartSpawn);
        setHeartSchedule(c.heartSchedule ?? 'interval');
        setHeartIntervalMinutes(c.heartIntervalMinutes ?? 120);
        setHeartTimeOfDay(c.heartTimeOfDay ?? '12:00');
        setHeartTimezone(c.heartTimezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
        setHeartPeriodMinutes(c.heartPeriodMinutes ?? 360);
        setHeartSpawnDelayMinutes(c.heartSpawnDelayMinutes ?? 0);
        setHeartCap(c.heartCap ?? 1);
        setHeartPlacement(c.heartPlacement ?? 'random');
        setShowPlayerNames(c.showPlayerNames !== false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load game');
    }
  }, [token, gameId, player?.id]);

  useEffect(() => { void load(); }, [load]);

  // poll while in lobby so joiners appear
  useEffect(() => {
    if (detail?.game.status !== 'lobby') return;
    const id = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(id);
  }, [detail?.game.status, load]);

  // jump to the game screen once started
  useEffect(() => {
    if (detail?.game.status === 'active') navigate(`/game/${gameId}`, { replace: true });
  }, [detail?.game.status, gameId, navigate]);

  async function handleStart() {
    if (!token || !gameId || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editable) {
        // persist host knob edits (incl. bot composition) before launching.
        // Per-schedule fields are sent only for the active shape — the server
        // deletes whatever a schedule switch abandoned.
        await gameUpdate(token, gameId, {
          board, startingHp, startingAp, baseRange, apPerDay, upgradeCost,
          apIntervalMinutes: apSchedule === 'interval' ? apIntervalMinutes : undefined,
          apSchedule,
          apPeriodMinutes: apSchedule === 'random' ? apPeriodMinutes : undefined,
          apTimeOfDay: apSchedule === 'timeOfDay' ? apTimeOfDay : undefined,
          apTimezone: apSchedule === 'timeOfDay' ? apTimezone : undefined,
          apStealOnKill, heartGifts, revives, juryHaunt,
          heartSpawn,
          heartSchedule: heartSpawn ? heartSchedule : undefined,
          heartIntervalMinutes: heartSpawn && heartSchedule === 'interval' ? heartIntervalMinutes : undefined,
          heartTimeOfDay: heartSpawn && heartSchedule === 'timeOfDay' ? heartTimeOfDay : undefined,
          heartTimezone: heartSpawn && heartSchedule === 'timeOfDay' ? heartTimezone : undefined,
          heartPeriodMinutes: heartSpawn && heartSchedule === 'random' ? heartPeriodMinutes : undefined,
          heartSpawnDelayMinutes: heartSpawn ? heartSpawnDelayMinutes : undefined,
          heartCap: heartSpawn ? heartCap : undefined,
          heartPlacement: heartSpawn ? heartPlacement : undefined,
          showPlayerNames,
          bots,
        });
      }
      await gameStart(token, gameId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'start failed');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorScreen message={error} />;
  if (!detail) return <Loading label="Loading lobby…" />;

  const { game } = detail;
  const started = game.status !== 'lobby';
  // host can edit config in both test and play mode lobbies
  const editable = isHost && !started;

  const num = (v: string) => parseInt(v, 10) || 0;

  return (
    <main className="page">
      <h1>Lobby — {game.name}</h1>
      <p className="subtitle">
        {game.mode === 'test' ? 'Test mode' : 'Play mode'} · invite code: <strong>{game.inviteCode}</strong>
      </p>

      <section className="card" aria-label="Players">
        <h2>Players ({detail.members.length})</h2>
        <ul>
          {detail.members.map((m) => (
            <li key={m.player_id}>
              {m.is_bot ? <><Icon html={robotSvg} width={14} height={14} className="stat-icon" />{' '}{m.bot_difficulty} bot ({m.player_id})</> : m.player_id === detail.me ? `${player?.name} (you)` : detail.names?.[m.player_id] ?? m.player_id}
            </li>
          ))}
        </ul>
      </section>

      {editable && (
        <section className="card" aria-label="Game settings">
          <h2>Game settings</h2>
          <div className="knob-grid">
            <label htmlFor="knob-board">Board size</label>
            <input id="knob-board" type="number" min={5} max={15} value={board}
              onChange={(e) => setBoard(Math.min(15, Math.max(5, num(e.target.value))))} />

            <label htmlFor="knob-hp">Starting HP</label>
            <input id="knob-hp" type="number" min={1} max={10} value={startingHp}
              onChange={(e) => setStartingHp(Math.max(1, num(e.target.value)))} />

            <label htmlFor="knob-ap">Starting AP</label>
            <input id="knob-ap" type="number" min={0} max={10} value={startingAp}
              onChange={(e) => setStartingAp(Math.max(0, num(e.target.value)))} />

            <label htmlFor="knob-range">Base range</label>
            <input id="knob-range" type="number" min={1} max={5} value={baseRange}
              onChange={(e) => setBaseRange(Math.max(1, num(e.target.value)))} />

            <label htmlFor="knob-apday">AP per day</label>
            <input id="knob-apday" type="number" min={1} max={10} value={apPerDay}
              onChange={(e) => setApPerDay(Math.max(1, num(e.target.value)))} />

            <label htmlFor="knob-upgrade">Upgrade cost</label>
            <input id="knob-upgrade" type="number" min={1} max={10} value={upgradeCost}
              onChange={(e) => setUpgradeCost(Math.max(1, num(e.target.value)))} />
          </div>

          <h3>AP schedule</h3>
          <div className="knob-grid">
            <label htmlFor="knob-apsched">Schedule</label>
            <select id="knob-apsched" value={apSchedule}
              onChange={(e) => setApSchedule(e.target.value as ScheduleMode)}>
              {SCHEDULE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {apSchedule === 'interval' && (
              <>
                <label htmlFor="knob-interval">AP interval (minutes)</label>
                <input id="knob-interval" type="number" min={1} max={1440} value={apIntervalMinutes}
                  onChange={(e) => setApIntervalMinutes(Math.max(1, num(e.target.value)))} />
              </>
            )}
            {apSchedule === 'timeOfDay' && (
              <>
                <label htmlFor="knob-aptod">AP time (HH:mm)</label>
                <input id="knob-aptod" type="time" value={apTimeOfDay}
                  onChange={(e) => setApTimeOfDay(e.target.value)} />
                <label htmlFor="knob-aptz">Timezone</label>
                <TzPicker id="knob-aptz" value={apTimezone} onChange={setApTimezone} />
              </>
            )}
            {apSchedule === 'random' && (
              <>
                <label htmlFor="knob-apperiod">Period length (minutes)</label>
                <input id="knob-apperiod" type="number" min={1} max={1440} value={apPeriodMinutes}
                  onChange={(e) => setApPeriodMinutes(Math.max(1, num(e.target.value)))} />
              </>
            )}
          </div>
          {apSchedule === 'random' && (
            <p className="hint">AP lands once per period at a secret random minute — players see no countdown.</p>
          )}

          <h3>Rules</h3>
          <div className="check-grid">
            <label className="check-item">
              <input type="checkbox" checked={showPlayerNames} onChange={(e) => setShowPlayerNames(e.target.checked)} />
              <span className="check-text">
                <span className="check-title">Player names on tiles</span>
                <span className="check-sub">Show each tank&rsquo;s name stamped across the top of its square. Off for anonymous warfare.</span>
              </span>
            </label>
            <label className="check-item">
              <input type="checkbox" checked={apStealOnKill} onChange={(e) => setApStealOnKill(e.target.checked)} />
              <span className="check-text">
                <span className="check-title">Steal AP on kill</span>
                <span className="check-sub">The killer loots the victim&rsquo;s entire AP stash; off, it dies with them.</span>
              </span>
            </label>
            <label className="check-item">
              <input type="checkbox" checked={heartGifts} onChange={(e) => setHeartGifts(e.target.checked)} />
              <span className="check-text">
                <span className="check-title">Heart gifts</span>
                <span className="check-sub">Give 1 of your hearts (never AP) to heal an ally in range.</span>
              </span>
            </label>
            <label className="check-item">
              <input type="checkbox" checked={revives} onChange={(e) => setRevives(e.target.checked)} />
              <span className="check-text">
                <span className="check-title">Revives</span>
                <span className="check-sub">A gifted heart brings a dead player back at 1 HP / 0 AP, off the jury.</span>
              </span>
            </label>
            <label className="check-item">
              <input type="checkbox" checked={juryHaunt} onChange={(e) => setJuryHaunt(e.target.checked)} />
              <span className="check-text">
                <span className="check-title">Jury haunt</span>
                <span className="check-sub">The jury&rsquo;s most-voted living player earns no AP on the next tick.</span>
              </span>
            </label>
          </div>

          <h3>Hearts</h3>
          <div className="check-grid">
            <label className="check-item">
              <input type="checkbox" checked={heartSpawn} onChange={(e) => setHeartSpawn(e.target.checked)} />
              <span className="check-text">
                <span className="check-title">Spawn collectible hearts on the board</span>
                <span className="check-sub">Hearts appear on their own schedule; move onto one to claim it (+1 HP, or +2 AP at full HP).</span>
              </span>
            </label>
          </div>
          {heartSpawn && (
            <>
              <div className="knob-grid">
                <label htmlFor="knob-heartsched">Spawn schedule</label>
                <select id="knob-heartsched" value={heartSchedule}
                  onChange={(e) => setHeartSchedule(e.target.value as ScheduleMode)}>
                  {SCHEDULE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {heartSchedule === 'interval' && (
                  <>
                    <label htmlFor="knob-heartinterval">Spawn interval (minutes)</label>
                    <input id="knob-heartinterval" type="number" min={1} max={1440} value={heartIntervalMinutes}
                      onChange={(e) => setHeartIntervalMinutes(Math.max(1, num(e.target.value)))} />
                  </>
                )}
                {heartSchedule === 'timeOfDay' && (
                  <>
                    <label htmlFor="knob-hearttod">Spawn time (HH:mm)</label>
                    <input id="knob-hearttod" type="time" value={heartTimeOfDay}
                      onChange={(e) => setHeartTimeOfDay(e.target.value)} />
                    <label htmlFor="knob-hearttz">Timezone</label>
                    <TzPicker id="knob-hearttz" value={heartTimezone} onChange={setHeartTimezone} />
                  </>
                )}
                {heartSchedule === 'random' && (
                  <>
                    <label htmlFor="knob-heartperiod">Spawn period (minutes)</label>
                    <input id="knob-heartperiod" type="number" min={1} max={1440} value={heartPeriodMinutes}
                      onChange={(e) => setHeartPeriodMinutes(Math.max(1, num(e.target.value)))} />
                  </>
                )}
                <label htmlFor="knob-heartdelay">Spawn delay (minutes, 0 = immediately)</label>
                <input id="knob-heartdelay" type="number" min={0} max={1440} value={heartSpawnDelayMinutes}
                  onChange={(e) => setHeartSpawnDelayMinutes(Math.max(0, num(e.target.value)))} />
                <label htmlFor="knob-heartcap">Max hearts on the board</label>
                <input id="knob-heartcap" type="number" min={1} max={20} value={heartCap}
                  onChange={(e) => setHeartCap(Math.max(1, Math.min(20, num(e.target.value))))} />
                <label htmlFor="knob-heartplace">Placement</label>
                <select id="knob-heartplace" value={heartPlacement}
                  onChange={(e) => setHeartPlacement(e.target.value as 'random' | 'smart')}>
                  <option value="random">Random square</option>
                  <option value="smart">Smart (far from everyone)</option>
                </select>
              </div>
              <p className="hint">Spawn times are secret — move onto a heart to claim it (+1 HP, capped at your starting HP; at full HP it converts to +2 AP). The spawn delay keeps the early game heart-free, and at most {heartCap} unclaimed heart{heartCap === 1 ? '' : 's'} sit on the board at once.</p>
            </>
          )}

          <h3>Bots</h3>
          {bots.map((b, i) => (
            <div className="bot-row" key={i}>
              <label htmlFor={`bot-diff-${i}`}>Bot {i + 1} difficulty</label>
              <select
                id={`bot-diff-${i}`}
                aria-label="Bot difficulty"
                value={b.difficulty}
                onChange={(e) => setBots(bots.map((x, j) => j === i ? { difficulty: e.target.value as 'easy' | 'medium' | 'hard' } : x))}
              >
                {BOT_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button type="button" onClick={() => setBots(bots.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setBots([...bots, { difficulty: 'easy' }])}>Add bot</button>
        </section>
      )}

      {started && <p>Game has started — heading to the board…</p>}

      {isHost && !started && (
        <button className="primary" onClick={handleStart} disabled={busy}>Start game</button>
      )}
      {!isHost && !started && <p>Waiting for the host to start…</p>}
    </main>
  );
}
