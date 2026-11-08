import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { applyEvent, type ActionType, type GameEvent } from '@ttt/engine';
import Board, { type BoardMode } from '../components/Board';
import ActionBar from '../components/ActionBar';
import TankCard from '../components/TankCard';
import EventFeed from '../components/EventFeed';
import { useGameEvents } from '../lib/useGameEvents';
import { action } from '../lib/api';

export default function Game() {
  const { gameId } = useParams<{ gameId: string }>();
  const { state, events, me, detail, loading, error, refresh } = useGameEvents(gameId);
  const navigate = useNavigate();
  const [mode, setMode] = useState<BoardMode>('none');
  const [toast, setToast] = useState<string | null>(null);

  // dead player goes to the jury screen
  useEffect(() => {
    if (me && state?.players[me] && state.players[me].hp <= 0 && !state.winner) {
      navigate(`/game/${gameId}/jury`, { replace: true });
    }
  }, [me, state, gameId, navigate]);

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
      const r = await action(token, gameId, type, payload);
      // authoritative response replaces the optimistic view
      setMode('none');
      void refresh(); // realtime/refetch reconciles with the server
      void r;
    } catch (e) {
      // roll back by refetching authoritative state
      void refresh();
      setToast(e instanceof Error ? e.message : 'action failed');
      setTimeout(() => setToast(null), 4000);
    }
  }, [gameId, state, me, refresh]);

  if (loading) return <main className="page"><p>Loading game…</p></main>;
  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!state || !me) return <main className="page"><p>No game data.</p></main>;

  const mine = state.players[me];
  const inRangePlayers = Object.values(state.players).filter(
    (p) => p.id !== me && mine && mine.hp > 0
      && Math.abs(mine.pos.x - p.pos.x) + Math.abs(mine.pos.y - p.pos.y) <= mine.range,
  );

  return (
    <main className="page game-page">
      <header className="game-status">
        <span>Day {state.day}</span>
        <span className="mode-badge">{detail?.mode === 'test' ? 'TEST' : 'PLAY'}</span>
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
        <ActionBar
          state={state}
          me={me}
          mode={mode}
          onAction={doAction}
          onModeChange={setMode}
        />
      )}

      <Board state={state} selectedMode={mode} me={me} onCellTap={(pos) => {
        // tap semantics: in move mode a legal cell commits; in attack/give mode
        // an enemy in range commits; otherwise nothing
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
      }} />

      {mine && mine.hp > 0 && (
        <section className="card" aria-label="Your tank">
          <h2>Your tank</h2>
          <TankCard player={mine} isMe />
        </section>
      )}

      {inRangePlayers.length > 0 && mine && mine.hp > 0 && (
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

      {/* D6 mounts the HistoryScrubber here in test mode */}
      <span hidden>{events.length}</span>
    </main>
  );
}
