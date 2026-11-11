import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { createLocalGame } from '../lib/localGame';
import { useLocalGame } from '../lib/localGameContext';
import { ErrorScreen, Loading } from '../components/Status';

// Test Mode: guest sign-in only, no database game, no cron.
// Builds a local in-memory engine game (starting AP = 4), starts a client-side
// 30s AP drip, and routes to /game/local.
export default function TestMode() {
  const { guestSignin } = useAuth();
  const { setGame } = useLocalGame();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const token = await guestSignin();
        if (!token) throw new Error('no session');
        const game = createLocalGame({ startingAp: 4 });
        game.startApDrip(30_000);
        setGame(game);
        navigate('/game/local', { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to start test game');
      }
    })();
  }, [guestSignin, setGame, navigate]);

  if (error) return <ErrorScreen message={error} hint="Go back and try again — nothing was saved." />;
  return <Loading label="Setting up your local test game…" />;
}
