import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { gameGet, gameStart, gameUpdate, type GameDetail } from '../lib/api';

const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

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
  const [startingAp, setStartingAp] = useState(0);
  const [baseRange, setBaseRange] = useState(2);
  const [apPerDay, setApPerDay] = useState(1);
  const [upgradeCost, setUpgradeCost] = useState(2);
  const [apIntervalMinutes, setApIntervalMinutes] = useState(5);
  const [bots, setBots] = useState<{ difficulty: 'easy' | 'medium' | 'hard' }[]>([]);

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
        // persist host knob edits (incl. bot composition) before launching
        await gameUpdate(token, gameId, {
          board, startingHp, startingAp, baseRange, apPerDay, upgradeCost,
          apIntervalMinutes, bots,
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

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!detail) return <main className="page"><p>Loading…</p></main>;

  const { game } = detail;
  const started = game.status !== 'lobby';
  const editable = isHost && !started && game.mode === 'test';

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
              {m.is_bot ? `🤖 ${m.bot_difficulty} bot (${m.player_id})` : m.player_id === detail.me ? `${player?.name} (you)` : m.player_id}
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

            <label htmlFor="knob-interval">AP interval (minutes, test mode)</label>
            <input id="knob-interval" type="number" min={1} max={1440} value={apIntervalMinutes}
              onChange={(e) => setApIntervalMinutes(Math.max(1, num(e.target.value)))} />
          </div>

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
