import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  applyEvent, createInitialState, manhattan,
  type ActionType, type GameEvent, type GameState, type PlayerSpec,
} from '@ttt/engine';
import Board, { type BoardMode } from '../components/Board';
import ActionBar from '../components/ActionBar';
import TankCard from '../components/TankCard';
import EventFeed from '../components/EventFeed';
import HistoryScrubber from '../components/HistoryScrubber';
import { Icon, trophySvg } from '../lib/icons';
import { useGameEvents } from '../lib/useGameEvents';
import { useLocalGame, useLocalGameState } from '../lib/localGameContext';
import { action } from '../lib/api';

const BOT_NAMES: Record<string, string> = { easy: 'Easy Bot', medium: 'Medium Bot', hard: 'Hard Bot' };

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

  if (!game || !state) {
    return <main className="page"><p>Local test game not initialized.</p></main>;
  }

  const me = 'me';
  const mine = state.players[me];
  const inRangePlayers = Object.values(state.players).filter(
    (p) => p.id !== me && mine && mine.hp > 0 && manhattan(mine.pos, p.pos) <= mine.range,
  );

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
        <span>Day {state.day}</span>
        <span className="mode-badge">TEST</span>
        <Link to="/dashboard" className="link-button">Exit</Link>
      </header>

      {state.winner && (
        <div className="banner" data-testid="winner-banner">
          🏆 {state.players[state.winner]?.name ?? state.winner} wins!{' '}
          <Link to="/dashboard">Back to dashboard</Link>
        </div>
      )}

      {toast && <p className="error" role="alert">{toast}</p>}

      {!state.winner && mine && mine.hp > 0 && (
        <ActionBar state={state} me={me} mode={mode} onAction={doAction} onModeChange={setMode} />
      )}

      <Board
        state={state}
        selectedMode={mode}
        me={me}
        avatars={{}}
        onCellTap={(pos) => {
          if (mode === 'none') return;
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

      {!state.winner && mine && mine.hp > 0 && (
        <section className="card" aria-label="Your tank">
          <h2>Your tank</h2>
          <TankCard player={mine} isMe />
        </section>
      )}

      {!state.winner && inRangePlayers.length > 0 && mine && mine.hp > 0 && (
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
        <EventFeed log={state.log} />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Database-backed game mode (existing behaviour, unchanged).
// ---------------------------------------------------------------------------

interface DbGameViewProps { gameId: string }

function DbGameView({ gameId }: DbGameViewProps) {
  const { state, history, me, detail, avatars, loading, error, refresh } = useGameEvents(gameId);
  const navigate = useNavigate();
  const [mode, setMode] = useState<BoardMode>('none');
  const [toast, setToast] = useState<string | null>(null);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  // --- history scrubbing (test mode) ---
  const currentGenEvents: Array<GameEvent & { generation?: number }> = useMemo(
    () => history.filter((e) => e.generation === undefined || e.generation === detail?.generation),
    [history, detail],
  );

  const scrubbedState: GameState | null = useMemo(() => {
    if (scrubIdx === null || !state || !detail) return null;
    let s = createInitialState(state.config, specsFromDetail(state));
    for (const e of currentGenEvents.slice(0, scrubIdx)) {
      try { s = applyEvent(s, e); } catch { break; }
    }
    return s;
  }, [scrubIdx, state, detail, currentGenEvents]);

  const displayState: GameState | null = scrubbedState ?? state;
  const scrubbing = scrubIdx !== null;

  // AP countdown: seconds until the next AP point. Based on tickClockMinutes
  // + config.apIntervalMinutes, defaulting to a 30s local-test drip.
  const [apRemaining, setApRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!displayState) return;
    const intervalMinutes = displayState.config.apIntervalMinutes;
    const intervalSeconds = intervalMinutes && intervalMinutes > 0 ? intervalMinutes * 60 : 30;
    const elapsedSeconds = (displayState.tickClockMinutes ?? 0) * 60;
    let remaining = intervalSeconds - (elapsedSeconds % intervalSeconds);
    if (remaining <= 0) remaining = intervalSeconds;
    setApRemaining(remaining);
    const id = setInterval(() => {
      setApRemaining((t) => (t == null || t <= 1 ? intervalSeconds : t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [displayState]);

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

    // optimistic: apply locally first to confirm validity
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

    try {
      await action(token, gameId, type, payload);
      // authoritative response: realtime/refetch reconciles with the server
      setMode('none');
      void refresh();
    } catch (e) {
      // roll back by refetching authoritative state
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
      setScrubIdx(null);
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

  return (
    <main className="page game-page">
      <header className="game-status">
        <span>Day {displayState.day}</span>
        <span className="mode-badge">
          {detail?.mode === 'test' ? 'TEST' : 'PLAY'}{scrubbing ? ' · HISTORY' : ''}
        </span>
        {apRemaining != null && (
          <span className="timer" data-testid="ap-timer">
            Next AP in {apRemaining}s
          </span>
        )}
        <Link to="/dashboard" className="link-button">Exit</Link>
      </header>

      {displayState.winner && !scrubbing && (
        <div className="banner" data-testid="winner-banner">
          <Icon html={trophySvg} className="winner-icon" width={16} height={16} />{' '}
          {displayState.players[displayState.winner]?.name ?? displayState.winner} wins!{' '}
          <Link to="/dashboard">Back to dashboard</Link>
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

      {detail?.mode === 'test' && currentGenEvents.length > 0 && (
        <HistoryScrubber
          events={currentGenEvents}
          canFork={canFork}
          onFork={(seq) => void forkTo(seq)}
          onExit={() => setScrubIdx(null)}
          onScrub={(idx) => setScrubIdx(idx === currentGenEvents.length ? null : idx)}
        />
      )}

      <section className="card" aria-label="Events">
        <h2>Events</h2>
        <EventFeed log={displayState.log} />
      </section>
    </main>
  );
}

// Wired by TestMode so LocalGameView can drive actions against the live game.

export default function Game() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const isLocal = gameId === 'local' || searchParams.get('local') === '1';
  if (isLocal) return <LocalGameView />;
  return <DbGameView gameId={gameId} />;
}
