import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  applyEvent, createInitialState,
  type ActionType, type GameEvent, type GameState, type PlayerSpec,
} from '@ttt/engine';
import Board, { type BoardMode } from '../components/Board';
import ActionBar from '../components/ActionBar';
import { ErrorScreen, Loading } from '../components/Status';

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
  give_heart: 'gave a heart',
  heart_spawn: 'a heart appeared',
  upgrade_range: 'upgraded range',
  daily_tick: 'day tick',
  bot_action: 'bot acted',
  jury_vote: 'jury vote',
  fork: 'forked the timeline',
};

// Live battle feed: during play only final blows and revives are shown (the
// full event log stays post-game / in history scrubbing). Newest first.
function battleLines(state: GameState | null, limit = 12): { seq: number; text: string; kind: string }[] {
  return (state?.log ?? [])
    .filter((l) => l.kind === 'kill' || l.kind === 'revive')
    .slice(-limit)
    .reverse()
    .map((l) => ({ seq: l.seq, text: l.text, kind: l.kind as string }));
}

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

  // AP countdown: derived from the local drip's LAST actual tick (history),
  // not an independent counter — the two can never disagree. The drip interval
  // is the game's apIntervalMinutes (default 30s when unset). Once the game
  // has a winner the countdown stops and the engine drip is halted
  // (daily_tick bypasses the winner guard, so it must be stopped explicitly).
  const dripMs = (game?.state().config.apIntervalMinutes ?? 0) > 0
    ? game!.state().config.apIntervalMinutes * 60_000
    : 30_000;
  const lastDripAt: number | null = useMemo(() => {
    for (let i = game?.history.length ?? 0; i-- > 0;) {
      const e = game?.history[i];
      if (e?.type === 'daily_tick') return new Date(e.createdAt).getTime();
    }
    return null; // no tick yet: countdown runs from game start
  }, [game, game?.history.length]);
  const gameStartAt = useMemo(
    () => (game?.history[0] ? new Date(game.history[0].createdAt).getTime() : Date.now()),
    [game, game?.history.length],
  );
  const [apRemaining, setApRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (state?.winner) { setApRemaining(null); return; }
    const base = lastDripAt ?? gameStartAt;
    const compute = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      const interval = Math.round(dripMs / 1000);
      return Math.max(1, interval - (elapsed % interval));
    };
    setApRemaining(compute());
    const id = setInterval(() => setApRemaining(compute()), 1000);
    return () => clearInterval(id);
  }, [state?.winner, lastDripAt, gameStartAt, dripMs]);

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
        {!state.winner && state.config.apSchedule !== 'random' && (
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
          if (mode === 'move' && (!occId || state.players[occId].hp <= 0)) {
            // graves are passable: only a LIVING occupant blocks the move
            // (same rule the board highlight uses)
            void doAction('move', { to: pos });
          } else if ((mode === 'attack' || mode === 'give_ap') && occId && occId !== me && state.players[occId].hp > 0) {
            void doAction(mode, {
              targetId: occId,
              ...(mode === 'give_ap' ? { amount: 1 } : {}),
            });
          } else if (mode === 'give_heart' && occId && occId !== me) {
            // hearts may target graves too (a gift to a grave revives)
            void doAction('give_heart', { targetId: occId });
          }
        }}
      />

      {/* live battle log: final blows + revives only, during play */}
      {!state.winner && !scrubbing && battleLines(state).length > 0 && (
        <section className="card battle-card" aria-label="Battle log" data-testid="battle-log">
          <h2>Battle log</h2>
          <ul className="battle-log">
            {battleLines(state).map((l) => (
              <li key={l.seq} className={`battle-line kind-${l.kind}`}>{l.text}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Event feed is post-game only — identical to the database view so
          both modes behave the same; actions are hidden until the game ends */}
      {(state.winner || scrubbing) && (
        <section className="card" aria-label="Events">
          <h2>Events{scrubbing ? ' (History)' : ' (Post-Game)'}</h2>
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
      )}
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
  // when this client first saw the game active — fallback base for the AP
  // countdown before the server's first tick exists (lastTickAt is null)
  const gameStartedAtRef = useRef<number | null>(null);
  if (detail?.status === 'active' && gameStartedAtRef.current === null) {
    gameStartedAtRef.current = Date.now();
  }

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

  // --- history scrubbing / recap (post-game in both modes) ---
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

  // AP countdown: derived from the SERVER schedule, never a client guess.
  //   - interval games: base is detail.lastTickAt (the server's actual last
  //     grant; null = game just started, base is status-change time). Refresh-
  //     proof: every refetch recomputes from the same server timestamp, so the
  //     countdown cannot reset or stay at 0 — it lands back on the true value.
  //   - time-of-day games: target is the next apTimeOfDay slot in the
  //     schedule's timezone; the countdown shows time until that slot.
  // A won game (winner in state) or a server-marked finished game hides it.
  // 'random' schedules have no public countdown at all — the grant minute is
  // secret (derived from the seed), so there is nothing to count down to.
  const gameFinished = !!state?.winner || detail?.status === 'finished';
  const lastTickAt = detail?.lastTickAt ?? null;
  const sched = state?.config as {
    apIntervalMinutes?: number; apTimeOfDay?: string; apTimezone?: string;
    apSchedule?: 'interval' | 'timeOfDay' | 'random';
  } | undefined;
  const apScheduleMode = sched?.apSchedule ?? (sched?.apTimeOfDay ? 'timeOfDay' : 'interval');
  const apIntervalMinutes = sched?.apIntervalMinutes ?? 0;
  const apTimeOfDay = sched?.apTimeOfDay;
  const apTimezone = sched?.apTimezone;
  const gameStartedAt = gameStartedAtRef.current; // set when first active detail loads
  const [apRemaining, setApRemaining] = useState<number | null>(null);
  // grant-hold flag: true once the countdown reaches a grant boundary; cleared
  // when a refetch brings a new server lastTickAt (the grant was confirmed).
  const grantPendingRef = useRef(false);
  useEffect(() => { grantPendingRef.current = false; }, [lastTickAt]);
  useEffect(() => {
    if (gameFinished || apScheduleMode === 'random' || (!apIntervalMinutes && !apTimeOfDay)) {
      setApRemaining(null);
      return;
    }
    const compute = (): number | null => {
      const now = Date.now();
      if (apTimeOfDay) {
        // next slot at/after now, in the schedule's timezone (UTC fallback)
        const [h, m] = apTimeOfDay.split(':').map(Number);
        const fmt = new Intl.DateTimeFormat('en-GB', {
          timeZone: apTimezone || 'UTC', year: 'numeric', month: '2-digit',
          day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const p = fmt.formatToParts(new Date(now));
        const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
        const slotToday = Date.UTC(get('year'), get('month') - 1, get('day'), h, m);
        // tz "now" in UTC-terms: shift now by (tzWallclock - utcWallclock)
        const offsetMin = (get('hour') % 24) * 60 + get('minute') - (new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes());
        const tzNow = new Date(now + offsetMin * 60_000);
        const tzSlotToday = slotToday + offsetMin * 60_000;
        if (tzNow.getTime() < tzSlotToday) return Math.round((tzSlotToday - now) / 1000);
        // tomorrow's slot
        return Math.round((tzSlotToday + 86_400_000 - now) / 1000);
      }
      // interval: base = last server tick. With none yet, the server grants
      // immediately on its next cron fire, so the first countdown runs to the
      // top of the minute — not gameStart + interval (cron owns the phase).
      if (!lastTickAt) {
        if (!gameStartedAt) return null;
        return Math.round((60_000 - (now % 60_000)) / 1000);
      }
      const base = new Date(lastTickAt).getTime();
      const intervalSeconds = apIntervalMinutes * 60;
      const elapsed = Math.floor((now - base) / 1000);
      // grant boundary: hold at 0 until the server confirms the grant (a
      // refetch brings a new lastTickAt and resets the hold) — no rollover on
      // guesswork while the actual drip may be seconds late (cron jitter).
      if (grantPendingRef.current) return 0;
      if (elapsed >= intervalSeconds && elapsed % intervalSeconds === 0) {
        grantPendingRef.current = true;
        return 0;
      }
      return Math.max(0, intervalSeconds - (elapsed % intervalSeconds));
    };
    setApRemaining(compute());
    const id = setInterval(() => setApRemaining(compute()), 1000);
    return () => clearInterval(id);
  }, [gameFinished, apScheduleMode, apIntervalMinutes, apTimeOfDay, apTimezone, lastTickAt, gameStartedAt]);

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

  if (loading) return <Loading label="Loading game…" />;
  if (error) return <ErrorScreen message={error} />;
  if (!state || !me || !displayState) return <ErrorScreen message="No game data." />;

  const mine = state.players[me];

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
          // mode an occupant in range commits. Graves are passable and
          // revive-targetable: only LIVING occupants block/attack.
          if (scrubbing || mode === 'none') return;
          const occId = Object.entries(state.players).find(
            ([, p]) => p.pos.x === pos.x && p.pos.y === pos.y,
          )?.[0];
          if (mode === 'move' && (!occId || state.players[occId].hp <= 0)) {
            void doAction('move', { to: pos });
          } else if ((mode === 'attack' || mode === 'give_ap') && occId && occId !== me && state.players[occId].hp > 0) {
            void doAction(mode, {
              targetId: occId,
              ...(mode === 'give_ap' ? { amount: 1 } : {}),
            });
          } else if (mode === 'give_heart' && occId && occId !== me) {
            void doAction('give_heart', { targetId: occId });
          }
        }}
      />

      {/* live battle log: final blows + revives only, during play */}
      {!displayState.winner && !scrubbing && battleLines(state).length > 0 && (
        <section className="card battle-card" aria-label="Battle log" data-testid="battle-log">
          <h2>Battle log</h2>
          <ul className="battle-log">
            {battleLines(state).map((l) => (
              <li key={l.seq} className={`battle-line kind-${l.kind}`}>{l.text}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Event feed is post-game only — actions are hidden until the game ends */}
      {(displayState.winner || scrubbing) && (
        <section className="card" aria-label="Events">
          <h2>Events{scrubbing ? ' (History)' : ' (Post-Game)'}</h2>
          <EventFeed
            entries={feedEntries(history, state)}
            activeIndex={scrubIdx === null ? null : Math.min(scrubIdx, history.length) - 1}
            live={!scrubbing}
            onView={viewEvent}
            onReplay={() => { if (scrubIdx === null) setScrubIdx(0); setReplaying(true); }}
            onStop={exitScrub}
            replaying={replaying}
          />
        </section>
      )}
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
