import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gameGet, gameJoin } from '../lib/api';
import { useAuth } from '../lib/auth';

// /play — the canonical-game entry point. Joins the configured canonical
// game (VITE_CANONICAL_INVITE_CODE) and routes to it; without a configured
// code it falls back to the games page. Guests never join — they get the
// register prompt instead.
export default function Play() {
  const { token, isGuest } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || isGuest || started.current) return;
    started.current = true;
    const code = import.meta.env.VITE_CANONICAL_INVITE_CODE as string | undefined;
    if (!code) {
      navigate('/games', { replace: true });
      return;
    }
    (async () => {
      try {
        // idempotent: game-join returns the gameId for existing members
        const { gameId } = await gameJoin(token, code);
        const detail = await gameGet(token, gameId);
        navigate(detail.game.status === 'active' ? `/game/${gameId}` : `/lobby/${gameId}`,
          { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not join the game');
      }
    })();
  }, [token, isGuest, navigate]);

  if (isGuest) {
    return (
      <main className="page">
        <p>Guests can't join shared games — <Link to="/auth">register</Link> first.</p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <p className="error" role="alert">{error}</p>
        <button type="button" onClick={() => navigate('/games')}>Go to games</button>
      </main>
    );
  }
  return <main className="page"><p>Joining the war…</p></main>;
}
