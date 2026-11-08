import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  applyEvent, createInitialState, manhattan,
  type ActionType, type GameEvent, type GameState, type PlayerSpec,
} from '@ttt/engine';
import Board, { type BoardMode } from '../components/Board';
import ActionBar from '../components/ActionBar';
import TankCard from '../components/TankCard';
import EventFeed, { type FeedEntry } from '../components/EventFeed';
import { Icon, trophySvg } from '../lib/icons';
import { useGameEvents } from '../lib/useGameEvents';
import { useLocalGame, useLocalGameState } from '../lib/localGameContext';
import { action } from '../lib/api';

const BOT_NAMES: Record<string, string> = { easy: 'Easy Bot', medium: 'Medium Bot', hard: 'Hard Bot' };

// readable fallback for events without a log line (log lines win when present)
const EVENT_FALLBACK_TEXT: Record<string, string> = {
  move: 'moved',
  attack: 'attacked',
  give_ap: 'gave AP',
  upgrade_range: 'upgraded range',
  daily_tick: 'day tick',
  bot_action: 'bot acted',
  jury_vote: 'jury vote',
  fork: 'forked the timeline',
};

// Feed entries from the CANONICAL history (never the scrubbed log, which
// would drop the events that come after the viewed point). Text comes from
// the live log when it has a line for the seq, else a per-type fallback.
function feedEntries(events: GameEvent[], live: GameState | null): FeedEntry[] {
  const textBySeq = new Map<number, string>();
  for (const l of live?.log ?? []) textBySeq.set(l.seq, l.text);
  return events.map((e) => ({
    seq: e.seq,
    type: e.type,
    actorId: e.actorId,
    createdAt: e.createdAt,
    text: textBySeq.get(e.seq) ?? (EVENT_FALLBACK_TEXT[e.type] ?? e.type),
  }));
}

// PlayerSpecs for createInitialState, from the live state's player list
// (same ids every generation; names only affect log cosmetics in scrubbed
// views).
function specsFromDetail(state: GameState): PlayerSpec[] {
  return Object.values(state.players).map((p) => ({
    id: p.id,
    name: p.name || (p.isBot
      ? `${BOT_NAMES[p.botDifficulty ?? 'easy']} ${p.id.replace('bot-', '')}`
      : p.id),
    isBot: p.isBot,
    botDifficulty: p.botDifficulty,
  }));
}

// ---------------------------------------------------------------------------
// Local (test) mode: in-memory engine game, no database, no cron.
// ---------------------------------------------------------------------------

function LocalGameView() {
  const { game } = useLocalGame();
  const state = useLocalGameState();
  const [mode, setMode] = useState<BoardMode>('none');
  const [toast, setToast] = useState<string | null>(null);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);

  // AP countdown: the local drip runs every 30s (started at test-mode mount).
  // Once the game has a winner the countdown stops and the engine drip is
  // halted (daily_tick bypasses the winner guard, so it must be stopped
  // explicitly, not caught).
  const [apRemaining, setApRemaining] = useState(30);
  useEffect(() => {
    if (state?.winner) return;
    const id = setInterval(() => setApRemaining((t) => (t <= 1 ? 30 : t - 1)), 1000);
    return () => clearInterval(id);
  }, [state?.winner]);

  useEffect(() => {
    if (state?.winner && game) game.stopApDrip();
  }, [state, game]);

  // Recap replay: step the scrub position forward ~1 event/sec until live.
  const replayLen = game?.history.length ?? 0;
  const scrubIdxRef = useRef<number | null>(null);
  scrubIdxRef.current = scrubIdx;
  useEffect(() => {
    if (!replaying) return;
    const id = setInterval(() => {
      const next = (scrubIdxRef.current ?? 0) + 1;
      if (next >= replayLen) {
        setScrubIdx(null); // board already equals live; exit immediately
        setReplaying(false);
      } else {
        setScrubIdx(next);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [replaying, replayLen]);

  if (!game || !state) {
    return <main className="page"><p>Local test game not initialized.</p></main>;
  }

  const me = 'me';
  const mine = state.players[me];
  const scrubbing = scrubIdx !== null;
  const displayState = scrubbing ? game.replayTo(scrubIdx) : state;
  const exitScrub = () => { setReplaying(false); setMode('none'); setScrubIdx(null); };
  // Feed rows are addressed by their chronological index — no seq lookup, so
  // duplicate seqs can never highlight/scrub the wrong row.
  const viewEvent = (idx: number) => {
    setReplaying(false);
    setMode('none');
    setScrubIdx(idx + 1);
  };

  const inRangePlayers = Object.values(state.players).filter(
    (p) => p.id !== me && mine && mine.hp > 0 && manhattan(mine.pos, p.pos) <= mine.range,
  );

  // Newest applied event, or (while scrubbing/replaying) the event at the scrub
  // position — Board plays its fx for this event. scrubIdx is the index ONE
  // PAST the viewed event, so the viewed event is scrubIdx - 1.
  const lastEvent: GameEvent | null = scrubIdx !== null
    ? (game.history[Math.min(scrubIdx, game.history.length) - 1] ?? null)
    : (game.history[game.history.length - 1] ?? null);

  const doAction = useCallback((type: ActionType, payload: Record<string, unknown>) => {
    if (!mine || mine.hp <= 0) return;
    try {
      game.apply(type, payload);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'action failed');
      setTimeout(() => setToast(null), 4000);
      return;
    }
    setMode('none');
  }, [game, mine]);

  return (
    <main className="page game-page">
      <header className="game-status">
        <span>Day {displayState.day}</span>
        <span className="mode-badge">TEST{scrubbing ? ' · HISTORY' : ''}</span>
        {!state.winner && (
          <span className="timer" data-testid="ap-timer">Next AP in {apRemaining}s</span>
        )}
        <Link to="/games" className="link-button btn">Exit</Link>
      </header>

      {displayState.winner && !scrubbing && (
        <div className="banner" data-testid="winner-banner">
          <Icon html={trophySvg} className="winner-icon" width={16} height={16} />{' '}
          {displayState.players[displayState.winner]?.name ?? displayState.winner} wins!{' '}
          <Link to="/games">Back to games</Link>
        </div>
      )}

      {toast && <p className="error" role="alert">{toast}</p>}

      {!scrubbing && !state.winner && mine && mine.hp > 0 && (
        <ActionBar state={state} me={me} mode={mode} onAction={doAction} onModeChange={setMode} />
      )}

      <Board
        state={displayState}
        selectedMode={scrubbing ? 'none' : mode}
        me={me}
        avatars={{}}
        lastEvent={lastEvent}
        onCellTap={(pos) => {
          // historical board taps are inspection only — never commit actions
          if (scrubbing || mode === 'none') return;
          const occId = Object.entries(state.players).find(
            ([, p]) => p.pos.x === pos.x && p.pos.y === pos.y,
          )?.[0];
          if (mode === 'move' && !occId) {
            void doAction('move', { to: pos });
          } else if ((mode === 'attack' || mode === 'give_ap') && occId && occId !== me) {
            void doAction(mode === 'attack' ? 'attack' : 'give_ap', {
              targetId: occId,
              ...(mode === 'give_ap' ? { amount: 1 } : {}),
            });
          }
        }}
      />

      {!scrubbing && !state.winner && mine && mine.hp > 0 && (
        <section className="card" aria-label="Your tank">
          <h2>Your tank</h2>
          <TankCard player={mine} isMe />
        </section>
      )}

      {!scrubbing && !state.winner && inRangePlayers.length > 0 && mine && mine.hp > 0 && (
        <section className="card" aria-label="In range">
          <h2>In range</h2>
          {inRangePlayers.map((p) => (
            <TankCard
              key={p.id}
              player={p}
              isMe={false}
              onTap={() => {
                if (mode === 'attack') void doAction('attack', { targetId: p.id });
                else if (mode === 'give_ap') void doAction('give_ap', { targetId: p.id, amount: 1 });
              }}
            />
          ))}
        </section>
      )}

      <section className="card" aria-label="Events">
        <h2>Events</h2>
        <EventFeed
          entries={feedEntries(game.history, state)}
          activeIndex={scrubIdx === null ? null : Math.min(scrubIdx, game.history.length) - 1}
          live={!scrubbing}
          onView={viewEvent}
          onReplay={() => { if (scrubIdx === null) setScrubIdx(0); setReplaying(true); }}
          onStop={exitScrub}
          replaying={replaying}
        />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Database-backed game mode (existing behaviour, unchanged).
// ---------------------------------------------------------------------------

interface DbGameProps { gameId: string }

function DbGameView({ gameId }: DbGameProps) {
  const { state: authState, history: baseHistory, me, detail, avatars, loading, error, refresh } = useGameEvents(gameId);
  const navigate = useNavigate();
  const [mode, setMode] = useState<BoardMode>('none');
  const [toast, setToast] = useState<string | null>(null);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  // Optimistic actions: events posted but not yet confirmed by a refetch.
  // Applied on top of the authoritative state so the board reacts instantly;
  // the next authoritative snapshot (seq >= event.seq) drops them naturally.
  const [pending, setPending] = useState<GameEvent[]>([]);
  useEffect(() => {
    if (!authState) return;
    setPending((prev) => prev.filter((e) => e.seq > authState.seq));
  }, [authState]);

  const state = useMemo(() => {
    if (!authState || pending.length === 0) return authState;
    let s = authState;
    for (const e of pending) {
      try { s = applyEvent(s, e); } catch { break; }
    }
    return s;
  }, [authState, pending]);
  const history = useMemo(
    () => (pending.length ? [...baseHistory, ...pending] : baseHistory),
    [baseHistory, pending],
  );

  // --- history scrubbing / recap (any mode; test mode also forks) ---
  // Scrub position counts events from the very start of the game. Event seqs
  // are contiguous across fork generations (a fork continues at toSeq+1), so
  // replaying from the initial state over history[0..n] is always valid —
  // filtering to the current generation would hit a seq gap after a fork.
  const scrubbedState: GameState | null = useMemo(() => {
    if (scrubIdx === null || !state || !detail) return null;
    let s = createInitialState(state.config, specsFromDetail(state));
    for (const e of history.slice(0, scrubIdx)) {
      try { s = applyEvent(s, e); } catch { break; }
    }
    return s;
  }, [scrubIdx, state, detail, history]);

  const displayState: GameState | null = scrubbedState ?? state;
  const scrubbing = scrubIdx !== null;

  // Recap replay: step the scrub position forward ~1 event/sec until live.
  const [replaying, setReplaying] = useState(false);
  const scrubIdxRef = useRef<number | null>(null);
  scrubIdxRef.current = scrubIdx;
  useEffect(() => {
    if (!replaying) return;
    const id = setInterval(() => {
      const next = (scrubIdxRef.current ?? 0) + 1;
      if (next >= history.length) {
        setScrubIdx(null); // board already equals live; exit immediately
        setReplaying(false);
      } else {
        setScrubIdx(next);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [replaying, history]);

  const exitScrub = () => { setReplaying(false); setMode('none'); setScrubIdx(null); };
  // Feed rows are addressed by their chronological index — no seq lookup, so
  // duplicate seqs can never highlight/scrub the wrong row.
  const viewEvent = (idx: number) => {
    setReplaying(false);
    setMode('none');
    setScrubIdx(idx + 1);
  };

  // AP countdown: seconds until the next AP point. Only shown for games with
  // a client-known interval (apIntervalMinutes > 0). Daily server-managed AP
  // (0) has no client-visible schedule, so the timer hides.
  // Derived from the LIVE state (never the scrubbed display state) so
  // scrubbing through history does not reset the countdown.
  const apIntervalMinutes = state?.config.apIntervalMinutes ?? 0;
  const liveClockMinutes = state?.tickClockMinutes ?? 0;
  // A won game (winner in state) or a server-marked finished game stops the
  // AP countdown and hides the timer.
  const gameFinished = !!state?.winner || detail?.status === 'finished';
  const [apRemaining, setApRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (gameFinished) {
      setApRemaining(null);
      return;
    }
    if (!apIntervalMinutes || apIntervalMinutes <= 0) {
      setApRemaining(null);
      return;
    }
    const intervalSeconds = apIntervalMinutes * 60;
    let remaining = intervalSeconds - (liveClockMinutes * 60) % intervalSeconds;
    if (remaining <= 0) remaining = intervalSeconds;
    setApRemaining(remaining);
    const id = setInterval(() => {
      setApRemaining((t) => (t == null || t <= 1 ? intervalSeconds : t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [gameFinished, apIntervalMinutes, liveClockMinutes]);

  // dead player goes to the jury screen
  useEffect(() => {
    if (!scrubbing && me && state?.players[me] && state.players[me].hp <= 0 && !state.winner) {
      navigate(`/game/${gameId}/jury`, { replace: true });
    }
  }, [me, state, gameId, navigate, scrubbing]);

  const doAction = useCallback(async (type: ActionType, payload: Record<string, unknown>) => {
    if (!gameId || !state || !me) return;
    const token = localStorage.getItem('ttt_token');
    if (!token) return;

    // optimistic: validate against authoritative state, then commit locally so
    // the board updates before the network round-trip completes
    const optimisticEvent: GameEvent = {
      seq: state.seq + 1, type, actorId: me, createdAt: new Date().toISOString(), payload,
    };
    try {
      applyEvent(state, optimisticEvent);
      setMode('none');
    } catch {
      // invalid locally — engine buttons should have prevented this
      return;
    }
    setPending((prev) => [...prev, optimisticEvent]);

    try {
      await action(token, gameId, type, payload);
      // authoritative response: realtime/refetch reconciles with the server
      void refresh();
    } catch (e) {
      // roll back the optimistic apply and refetch authoritative state
      setPending([]);
      void refresh();
      setToast(e instanceof Error ? e.message : 'action failed');
      setTimeout(() => setToast(null), 4000);
    }
  }, [gameId, state, me, refresh]);

  async function forkTo(seq: number) {
    if (!gameId) return;
    const token = localStorage.getItem('ttt_token');
    if (!token) return;
    try {
      await action(token, gameId, 'fork', { toSeq: seq });
      exitScrub();
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'rewind failed');
      setTimeout(() => setToast(null), 4000);
    }
  }

  if (loading) return <main className="page"><p>Loading game…</p></main>;
  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!state || !me || !displayState) return <main className="page"><p>No game data.</p></main>;

  const mine = state.players[me];
  const inRangePlayers = Object.values(state.players).filter(
    (p) => p.id !== me && mine && mine.hp > 0
      && manhattan(mine.pos, p.pos) <= mine.range,
  );
  const canFork = detail?.mode === 'test' && detail.createdBy === me;

  // Newest applied event, or (while scrubbing/replaying) the event at the scrub
  // position — Board plays its fx for this event. scrubIdx is the index ONE
  // PAST the viewed event, so the viewed event is scrubIdx - 1.
  const lastEvent: GameEvent | null = scrubIdx !== null
    ? (history[Math.min(scrubIdx, history.length) - 1] ?? null)
    : (history[history.length - 1] ?? null);

  return (
    <main className="page game-page">
      <header className="game-status">
        <span>Day {displayState.day}</span>
        <span className="mode-badge">
          {detail?.mode === 'test' ? 'TEST' : 'PLAY'}{scrubbing ? ' · HISTORY' : ''}
        </span>
        {!gameFinished && apRemaining != null && (
          <span className="timer" data-testid="ap-timer">
            Next AP in {apRemaining}s
          </span>
        )}
        <Link to="/games" className="link-button btn">Exit</Link>
      </header>

      {displayState.winner && !scrubbing && (
        <div className="banner" data-testid="winner-banner">
          <Icon html={trophySvg} className="winner-icon" width={16} height={16} />{' '}
          {displayState.players[displayState.winner]?.name ?? displayState.winner} wins!{' '}
          <Link to="/games">Back to games</Link>
        </div>
      )}

      {toast && <p className="error" role="alert">{toast}</p>}

      {!scrubbing && !displayState.winner && mine && mine.hp > 0 && (
        <ActionBar
          state={state}
          me={me}
          mode={mode}
          onAction={doAction}
          onModeChange={setMode}
        />
      )}

      <Board
        state={displayState}
        selectedMode={scrubbing ? 'none' : mode}
        me={me}
        avatars={avatars}
        lastEvent={lastEvent}
        onCellTap={(pos) => {
          // tap semantics: in move mode a legal cell commits; in attack/give
          // mode an enemy in range commits; otherwise nothing
          if (scrubbing || mode === 'none') return;
          const occId = Object.entries(state.players).find(
            ([, p]) => p.pos.x === pos.x && p.pos.y === pos.y,
          )?.[0];
          if (mode === 'move' && !occId) {
            void doAction('move', { to: pos });
          } else if ((mode === 'attack' || mode === 'give_ap') && occId && occId !== me) {
            void doAction(mode === 'attack' ? 'attack' : 'give_ap', {
              targetId: occId,
              ...(mode === 'give_ap' ? { amount: 1 } : {}),
            });
          }
        }}
      />

      {!scrubbing && mine && mine.hp > 0 && (
        <section className="card" aria-label="Your tank">
          <h2>Your tank</h2>
          <TankCard player={mine} isMe />
        </section>
      )}

      {!scrubbing && inRangePlayers.length > 0 && mine && mine.hp > 0 && (
        <section className="card" aria-label="In range">
          <h2>In range</h2>
          {inRangePlayers.map((p) => (
            <TankCard
              key={p.id}
              player={p}
              isMe={false}
              onTap={() => {
                if (mode === 'attack') void doAction('attack', { targetId: p.id });
                else if (mode === 'give_ap') void doAction('give_ap', { targetId: p.id, amount: 1 });
              }}
            />
          ))}
        </section>
      )}

      <section className="card" aria-label="Events">
        <h2>Events</h2>
        <EventFeed
          entries={feedEntries(history, state)}
          activeIndex={scrubIdx === null ? null : Math.min(scrubIdx, history.length) - 1}
          live={!scrubbing}
          onView={viewEvent}
          onReplay={() => { if (scrubIdx === null) setScrubIdx(0); setReplaying(true); }}
          onStop={exitScrub}
          replaying={replaying}
          canFork={canFork}
          onFork={(idx) => {
            const seq = history[idx]?.seq;
            if (seq !== undefined) void forkTo(seq);
          }}
        />
      </section>
    </main>
  );
}

// Wired by TestMode so LocalGameView can drive actions against the live game.

export default function Game() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  if (gameId === 'local' || searchParams.get('local') === '1') return <LocalGameView />;
  if (!gameId) return <main className="page"><p>No game specified.</p></main>;
  return <DbGameView gameId={gameId} />;
}
