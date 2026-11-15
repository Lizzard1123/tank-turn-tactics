import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  applyEvent, createInitialState, viewerLogReveal,
  type ActionType, type GameEvent, type GameState, type PlayerSpec,
} from '@ttt/engine';
import Board, { type BoardMode } from '../components/Board';
import ActionBar from '../components/ActionBar';
import ConfirmDialog from '../components/ConfirmDialog';
import BattleLog from '../components/BattleLog';
import ReviveChooser from '../components/ReviveChooser';
import { ErrorScreen, Loading } from '../components/Status';
import { useApCountdown, formatCountdown } from '../lib/useApCountdown';

import EventFeed, { type FeedEntry } from '../components/EventFeed';
import { Icon, trophySvg } from '../lib/icons';
import { useGameEvents } from '../lib/useGameEvents';
import { useLocalGame, useLocalGameState } from '../lib/localGameContext';
import { action } from '../lib/api';

// Countdown formatting lives with the countdown hook (shared with the jury
// screen); re-exported so existing imports from './Game' keep working.
export { formatCountdown };

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
  jury_result: 'jury verdict',
  fork: 'forked the timeline',
};

// Directional text for move actions: "move up", "move down", "move left", "move right"
function moveDirection(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Primary axis: the larger absolute delta wins; tie-break dy > dx → vertical
  const primary = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  if (primary === 'x') {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

// Compute a human-readable confirmation message for a pending action.
// `mine` is the acting player — position for directional moves, and their
// CURRENT range (not config.baseRange) for upgrade messages.
function actionMessage(
  type: ActionType,
  payload: Record<string, unknown>,
  mine: GameState['players'][string] | undefined,
  state: GameState,
): string {
  const players = state.players;
  switch (type) {
    case 'move': {
      const to = payload.to as { x: number; y: number } | undefined;
      if (!to || !mine) return 'move';
      return `move ${moveDirection(mine.pos, to)}`;
    }
    case 'attack': {
      const targetId = payload.targetId as string | undefined;
      const target = targetId ? players[targetId] : null;
      return `attack ${target?.name ?? targetId ?? 'target'}`;
    }
    case 'give_ap': {
      const targetId = payload.targetId as string | undefined;
      const target = targetId ? players[targetId] : null;
      return `give AP to ${target?.name ?? targetId ?? 'target'}`;
    }
    case 'give_heart': {
      const targetId = payload.targetId as string | undefined;
      const target = targetId ? players[targetId] : null;
      // Check if revives is on and target is dead
      const isRevive = target && target.hp! <= 0 && state.config.revives;
      return `give heart to ${target?.name ?? targetId ?? 'target'}${isRevive ? ' to revive' : ''}`;
    }
    case 'upgrade_range': {
      const currentRange = mine?.range ?? state.config.baseRange;
      return `upgrade range from ${currentRange} to ${currentRange + 1}`;
    }
    default:
      return type;
  }
}

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
// Jury business is dead-viewer-only: per-vote rows never show for anyone
// (the ballot is secret), and the outcome row only for entitled viewers.
function feedEntries(events: GameEvent[], live: GameState | null, showJury: boolean): FeedEntry[] {
  const textBySeq = new Map<number, string>();
  for (const l of live?.log ?? []) textBySeq.set(l.seq, l.text);
  return events
    .filter((e) => e.type !== 'jury_vote' && (showJury || e.type !== 'jury_result'))
    .map((e) => ({
      seq: e.seq,
      type: e.type,
      actorId: e.actorId,
      createdAt: e.createdAt,
      text: textBySeq.get(e.seq) ?? (EVENT_FALLBACK_TEXT[e.type] ?? e.type),
    }));
}

// PlayerSpecs for createInitialState, from the live state's player list
// (same ids every generation; names only affect log cosmetics in scrubbed
// views). Iterates state.order — the authoritative player order — so the
// client fallback matches game-get's server-side initial derivation, which
// also uses state.order (spawn placement is order-sensitive).
function specsFromDetail(state: GameState): PlayerSpec[] {
  return state.order.map((id) => {
    const p = state.players[id];
    return {
      id: p.id,
      name: p.name || (p.isBot
        ? `${BOT_NAMES[p.botDifficulty ?? 'easy']} ${p.id.replace('bot-', '')}`
        : p.id),
      isBot: p.isBot,
      botDifficulty: p.botDifficulty,
    };
  });
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
  const [pendingAction, setPendingAction] = useState<{
    type: ActionType;
    payload: Record<string, unknown>;
    message: string;
  } | null>(null);
  // give_heart on a square with 2+ graves: choose who gets revived
  const [reviveChoice, setReviveChoice] = useState<string[] | null>(null);
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

  // Every action request — from the action bar buttons or a board cell tap —
  // becomes a pending confirmation; handleConfirm submits on "Yes".
  const doAction = useCallback((type: ActionType, payload: Record<string, unknown>) => {
    if (!mine || mine.hp <= 0) return;
    if (pendingAction != null) return;
    setPendingAction({ type, payload, message: actionMessage(type, payload, mine, state) });
  }, [mine, state, pendingAction]);

  const handleCellTap = useCallback((pos: { x: number; y: number }) => {
    if (scrubbing || mode === 'none') return;
    const occId = Object.entries(state.players).find(
      ([, p]) => p.pos.x === pos.x && p.pos.y === pos.y,
    )?.[0];

    // If there's a pending confirmation, don't queue another
    if (pendingAction != null) return;

    // Determine action type from mode
    if (mode === 'move' && (!occId || state.players[occId]?.hp <= 0)) {
      doAction('move', { to: pos });
    } else if ((mode === 'attack' || mode === 'give_ap') && occId && occId !== me && state.players[occId]?.hp > 0) {
      doAction(mode as ActionType, {
        targetId: occId,
        ...(mode === 'give_ap' ? { amount: 1 } : {}),
      });
    } else if (mode === 'give_heart' && occId && occId !== me) {
      // multiple graves on this square: pick who gets the revive
      const crowd = Object.values(state.players).filter(
        (p) => p.hp <= 0 && p.pos.x === pos.x && p.pos.y === pos.y && p.id !== me,
      );
      if (crowd.length > 1) {
        setReviveChoice(crowd.map((p) => p.id));
        return;
      }
      doAction('give_heart', { targetId: occId });
    }
    // toggle off: tapping a cell when no target matches exits the mode
    else {
      setMode('none');
    }
  }, [scrubbing, mode, state, me, doAction]);

  const handleRevivePick = useCallback((targetId: string) => {
    setReviveChoice(null);
    doAction('give_heart', { targetId });
  }, [doAction]);

  const handleConfirm = useCallback(() => {
    if (!pendingAction) return;
    const { type, payload } = pendingAction;
    if (!mine || mine.hp <= 0) {
      setPendingAction(null);
      setMode('none');
      return;
    }
    try {
      game.apply(type, payload);
      setMode('none');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'action failed');
      setTimeout(() => setToast(null), 4000);
    }
    setPendingAction(null);
  }, [pendingAction, mine, game]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
  }, []);

  return (
    <main className="page game-page">
      <header className="game-status">
        <span>Day {displayState.day}</span>
        <span className="mode-badge">TEST{scrubbing ? ' · HISTORY' : ''}</span>
        {!state.winner && state.config.apSchedule !== 'random' && (
          <span className="timer" data-testid="ap-timer">AP in {formatCountdown(apRemaining ?? 0)}</span>
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
        onCellTap={handleCellTap}
      />

      {/* live battle log: final blows + revives only, during play —
          collapsed by default so mobile fits without scrolling */}
      {!state.winner && !scrubbing && battleLines(state).length > 0 && (
        <BattleLog lines={battleLines(state)} />
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        action={pendingAction?.message ?? null}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* revive chooser: multiple graves on one square */}
      <ReviveChooser
        deadIds={reviveChoice}
        players={state.players}
        onPick={handleRevivePick}
        onClose={() => setReviveChoice(null)}
      />

      {/* Event feed is post-game only — identical to the database view so
          both modes behave the same; actions are hidden until the game ends */}
      {(state.winner || scrubbing) && (
        <section className="card" aria-label="Events">
          <h2>Events{scrubbing ? ' (History)' : ' (Post-Game)'}</h2>
          <EventFeed
            entries={feedEntries(game.history, state, viewerLogReveal(state, me))}
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
  const [pendingAction, setPendingAction] = useState<{
    type: ActionType;
    payload: Record<string, unknown>;
    message: string;
  } | null>(null);
  // give_heart on a square with 2+ graves: choose who gets revived
  const [reviveChoice, setReviveChoice] = useState<string[] | null>(null);

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
  // The starting state comes from the server (`detail.initial` — exact, and
  // lets the wire stay seed-free); the client-side createInitialState path
  // remains as a fallback for older responses.
  const scrubbedState: GameState | null = useMemo(() => {
    if (scrubIdx === null || !state || !detail) return null;
    let s = detail.initial
      ? (structuredClone(detail.initial) as GameState)
      : createInitialState(state.config, specsFromDetail(state));
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

  // AP countdown (shared hook, also used by the jury screen)
  const apRemaining = useApCountdown(state, detail);

  // dead player goes to the jury screen
  useEffect(() => {
    if (!scrubbing && me && state?.players[me] && state.players[me].hp <= 0 && !state.winner) {
      navigate(`/game/${gameId}/jury`, { replace: true });
    }
  }, [me, state, gameId, navigate, scrubbing]);

  // Every action request — from the action bar buttons or a board cell tap —
  // becomes a pending confirmation; handleConfirm submits on "Yes".
  const doAction = useCallback((type: ActionType, payload: Record<string, unknown>) => {
    if (!gameId || !state || !me) return;
    if (pendingAction != null) return;
    setPendingAction({
      type, payload,
      message: actionMessage(type, payload, state.players[me], state),
    });
  }, [gameId, state, me, pendingAction]);

  const handleCellTap = useCallback((pos: { x: number; y: number }) => {
    if (scrubbing || mode === 'none' || !state) return;
    const occId = Object.entries(state.players).find(
      ([, p]) => p.pos.x === pos.x && p.pos.y === pos.y,
    )?.[0];

    // If there's a pending confirmation, don't queue another
    if (pendingAction != null) return;

    // Determine action type from mode
    if (mode === 'move' && (!occId || state.players[occId]?.hp <= 0)) {
      doAction('move', { to: pos });
    } else if ((mode === 'attack' || mode === 'give_ap') && occId && occId !== me && state.players[occId]?.hp > 0) {
      doAction(mode as ActionType, {
        targetId: occId,
        ...(mode === 'give_ap' ? { amount: 1 } : {}),
      });
    } else if (mode === 'give_heart' && occId && occId !== me) {
      // multiple graves on this square: pick who gets the revive
      const crowd = Object.values(state.players).filter(
        (p) => p.hp <= 0 && p.pos.x === pos.x && p.pos.y === pos.y && p.id !== me,
      );
      if (crowd.length > 1) {
        setReviveChoice(crowd.map((p) => p.id));
        return;
      }
      doAction('give_heart', { targetId: occId });
    }
    // toggle off: tapping a cell when no target matches exits the mode
    else {
      setMode('none');
    }
  }, [scrubbing, mode, state, me, doAction]);

  const handleRevivePick = useCallback((targetId: string) => {
    setReviveChoice(null);
    doAction('give_heart', { targetId });
  }, [doAction]);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    const { type, payload } = pendingAction;
    if (!gameId || !state || !me) {
      setPendingAction(null);
      setMode('none');
      return;
    }
    const token = localStorage.getItem('ttt_token');
    if (!token) {
      setPendingAction(null);
      setMode('none');
      return;
    }

    // optimistic: validate against authoritative state, then commit locally
    const optimisticEvent: GameEvent = {
      seq: state.seq + 1, type, actorId: me, createdAt: new Date().toISOString(), payload,
    };
    try {
      applyEvent(state, optimisticEvent);
    } catch {
      setPendingAction(null);
      setMode('none');
      return;
    }
    setPending((prev) => [...prev, optimisticEvent]);

    try {
      await action(token, gameId, type, payload);
      void refresh();
    } catch (e) {
      setPending([]);
      void refresh();
      setToast(e instanceof Error ? e.message : 'action failed');
      setTimeout(() => setToast(null), 4000);
    }
    setPendingAction(null);
    setMode('none');
  }, [pendingAction, gameId, state, me, refresh]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
  }, []);

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
        {!(state?.winner || detail?.status === 'finished') && apRemaining != null && (
          <span className="timer" data-testid="ap-timer">
            AP in {formatCountdown(apRemaining)}
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
        onCellTap={handleCellTap}
      />

      {/* live battle log: final blows + revives only, during play —
          collapsed by default so mobile fits without scrolling */}
      {!displayState.winner && !scrubbing && battleLines(state).length > 0 && (
        <BattleLog lines={battleLines(state)} />
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        action={pendingAction?.message ?? null}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* revive chooser: multiple graves on one square */}
      <ReviveChooser
        deadIds={reviveChoice}
        players={state.players}
        onPick={handleRevivePick}
        onClose={() => setReviveChoice(null)}
      />

      {/* Event feed is post-game only — actions are hidden until the game ends */}
      {(displayState.winner || scrubbing) && (
        <section className="card" aria-label="Events">
          <h2>Events{scrubbing ? ' (History)' : ' (Post-Game)'}</h2>
          <EventFeed
            entries={feedEntries(history, state, viewerLogReveal(state, me))}
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
