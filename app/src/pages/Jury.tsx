import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Board from '../components/Board';
import EventFeed from '../components/EventFeed';
import TankCard from '../components/TankCard';
import { Icon, skullSvg, clipboardSvg } from '../lib/icons';
import { useGameEvents } from '../lib/useGameEvents';
import { useApCountdown, formatCountdown } from '../lib/useApCountdown';
import { action } from '../lib/api';
import { ErrorScreen, Loading } from '../components/Status';

// Screen for eliminated players: watch the board, vote on AP bonuses.
export default function Jury() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { state, me, avatars, refresh, detail } = useGameEvents(gameId);
  // same server-derived AP countdown the game screen shows
  const apRemaining = useApCountdown(state, detail);

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
      {/* same nav bar as the Lobby/Dashboard: back on the left, config and
          profile on the right; the extra bottom margin separates it from the
          status bar below */}
      <nav className="jury-nav">
        <Link to="/games" className="link-button btn">← Back</Link>
        <span className="row" style={{ gap: 8 }}>
          <Link to="/config" className="link-button btn" data-testid="nav-config" aria-label="Game config">
            <Icon html={clipboardSvg} width={14} height={14} /> Config
          </Link>
          <Link to="/profile" className="link-button btn">Profile</Link>
        </span>
      </nav>
      <header className="game-status">
        <span>Day {state.day}</span>
        <span className="mode-badge">JURY</span>
        {/* same server-derived countdown as the game header; the hook yields
            null for 'random' schedules (grant minute is secret) and for games
            without an AP interval, which hides the chip */}
        {!state.winner && apRemaining != null && (
          <span className="timer" data-testid="ap-timer">AP in {formatCountdown(apRemaining)}</span>
        )}
      </header>

      {/* the board is always visible — jury members spectate the war (with
          revives on, the live event feed stays hidden — the board is all a
          dead player sees; with revives off it shows below). */}
      <Board state={state} selectedMode="none" me={me} avatars={avatars} onCellTap={() => {}} />

      <section className="card" aria-label="Alive players">
        <h2>Alive players</h2>
        <p className="subtitle" data-testid="jury-subtitle">
          <Icon html={skullSvg} width={14} height={14} className="stat-icon" />{' '}
          You are on the jury — vote daily to grant a player bonus AP (3+ votes
          needed). Your votes are not public — no one can see who you voted for.
        </p>
        {alive.map((p) => {
          const mine = p.id === myVote;
          return (
            <div className="jury-row" key={p.id}>
              {/* cards stay name-only in both rule sets: HP already shows as a
                  life bar on the board, and revives-on fog of war hides it too */}
              <TankCard player={p} isMe={false} hideStats />
              {/* the ballot is changeable all day: your current choice is
                  pinned, everyone else offers a one-click switch */}
              <button
                data-testid={`vote-${p.id}`}
                disabled={mine}
                onClick={() => void vote(p.id)}
              >
                {mine ? 'Your vote' : myVote ? 'Change vote' : 'Vote'}
              </button>
            </div>
          );
        })}
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
