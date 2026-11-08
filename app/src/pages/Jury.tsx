import { useParams } from 'react-router-dom';
import Board from '../components/Board';
import EventFeed from '../components/EventFeed';
import TankCard from '../components/TankCard';
import { Icon, skullSvg } from '../lib/icons';
import { useGameEvents } from '../lib/useGameEvents';
import { action } from '../lib/api';

// Screen for eliminated players: watch the board, vote on AP bonuses.
export default function Jury() {
  const { gameId } = useParams<{ gameId: string }>();
  const { state, me, avatars, refresh } = useGameEvents(gameId);

  if (!state || !me) {
    return <main className="page"><p>{state ? 'You are not on the jury.' : 'Loading…'}</p></main>;
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

      <section className="card" aria-label="Alive players">
        <h2>Alive players</h2>
        {alive.map((p) => (
          <div className="jury-row" key={p.id}>
            <TankCard player={p} isMe={false} />
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

      <Board state={state} selectedMode="none" me={me} avatars={avatars} onCellTap={() => {}} />

      <section className="card" aria-label="Events">
        <h2>Events</h2>
        <EventFeed log={state.log} />
      </section>
    </main>
  );
}
