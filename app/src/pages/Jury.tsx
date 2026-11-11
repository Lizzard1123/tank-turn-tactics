import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Board from '../components/Board';
import EventFeed from '../components/EventFeed';
import TankCard from '../components/TankCard';
import { Icon, skullSvg } from '../lib/icons';
import { useGameEvents } from '../lib/useGameEvents';
import { action } from '../lib/api';
import { ErrorScreen, Loading } from '../components/Status';

// Screen for eliminated players: watch the board, vote on AP bonuses.
export default function Jury() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { state, me, avatars, refresh } = useGameEvents(gameId);

  // revived (or game over while here): back to the game screen — the jury
  // board is read-only, so a revived player stuck here could not move
  useEffect(() => {
    if (state && me && state.players[me] && state.players[me].hp > 0) {
      navigate(`/game/${gameId}`, { replace: true });
    }
  }, [state, me, gameId, navigate]);

  if (!state || !me) {
    return state
      ? <ErrorScreen message="You are not on the jury." />
      : <Loading label="Loading jury…" />;
  }

  const alive = Object.values(state.players).filter((p) => p.hp > 0);
  const alreadyVoted = state.pendingVotes.some((v) => v.voterId === me);
  const myVote = state.pendingVotes.find((v) => v.voterId === me)?.candidateId;

  async function vote(candidateId: string) {
    if (!gameId) return;
    const token = localStorage.getItem('ttt_token');
    if (!token) return;
    try {
      await action(token, gameId, 'jury_vote', { candidateId });
      await refresh();
    } catch {
      // vote rejected (already voted, candidate dead, etc.) — refetch to sync
      await refresh();
    }
  }

  return (
    <main className="page">
      <nav>
        <Link to="/games" className="link-button btn">← Back</Link>
      </nav>
      <header className="game-status">
        <span>Day {state.day}</span>
        <span className="mode-badge">JURY</span>
      </header>

      <p className="subtitle">
        <Icon html={skullSvg} width={14} height={14} className="stat-icon" /> You are on the jury — vote daily to grant a player bonus AP (3+ votes needed).
      </p>

      {alreadyVoted && (
        <p className="banner" data-testid="voted-banner">
          You voted for {state.players[myVote ?? '']?.name ?? myVote} today.
        </p>
      )}

      {/* the board is always visible — jury members spectate the war. It sits
          above the votes; with revives on, the live event feed stays hidden
          (the board is all a dead player sees); with revives off it shows. */}
      <Board state={state} selectedMode="none" me={me} avatars={avatars} onCellTap={() => {}} />

      <section className="card" aria-label="Alive players">
        <h2>Alive players</h2>
        {alive.map((p) => (
          <div className="jury-row" key={p.id}>
            {/* revives on = fog of war: voters see names, not HP/range */}
            <TankCard player={p} isMe={false} hideStats={!!state.config.revives} />
            <button
              data-testid={`vote-${p.id}`}
              disabled={alreadyVoted}
              onClick={() => void vote(p.id)}
            >
              {alreadyVoted ? 'Voted' : 'Vote'}
            </button>
          </div>
        ))}
      </section>

      {state.config.juryHaunt && (
        <p className="banner" data-testid="haunt-banner">
          {state.haunted
            ? `${state.players[state.haunted]?.name ?? state.haunted} is haunted today — no AP for them.`
            : 'The most-voted player will be haunted (no AP next tick).'}
        </p>
      )}

      {state.config.revives ? (
        <p className="banner" data-testid="revive-waiting">
          Waiting for a heart… a living player can revive you by giving you one.
        </p>
      ) : (
        <section className="card" aria-label="Events">
          <h2>Events</h2>
          <EventFeed entries={state.log.map((l) => ({ seq: l.seq, text: l.text }))} activeIndex={null} live replaying={false} />
        </section>
      )}
    </main>
  );
}
