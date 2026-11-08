import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  applyEvent, createInitialState, manhattan,
  type ActionType, type GameEvent, type GameState, type PlayerSpec,
} from '@ttt/engine';
import Board, { type BoardMode } from '../components/Board';
import ActionBar from '../components/ActionBar';
import TankCard from '../components/TankCard';
import EventFeed from '../components/EventFeed';
import HistoryScrubber from '../components/HistoryScrubber';
import { useGameEvents } from '../lib/useGameEvents';
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

export default function Game() {
  const { gameId } = useParams<{ gameId: string }>();
  const { state, history, me, detail, avatars, loading, error, refresh } = useGameEvents(gameId);
  const navigate = useNavigate();
  const [mode, setMode] = useState<BoardMode>('none');
  const [toast, setToast] = useState<string | null>(null);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  // --- history scrubbing (test mode) ---
  // Reconstruct the initial state deterministically from config.seed, then
  // replay the first N events of the current generation. The slider index is
  // a position in the current generation's event list; rewind forks at the
  // seq of the last included event.
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
        <Link to="/dashboard" className="link-button">Exit</Link>
      </header>

      {displayState.winner && !scrubbing && (
        <div className="banner" data-testid="winner-banner">
          🏆 {displayState.players[displayState.winner]?.name ?? displayState.winner} wins!{' '}
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
