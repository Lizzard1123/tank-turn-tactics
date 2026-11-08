import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { gameCreate } from '../lib/api';

// Test Mode entry: ensures a guest session, creates a private test game
// with default knobs (full config editing happens in the lobby), and
// routes to its lobby.
export default function TestMode() {
  const { token, guestSignin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const t = token ?? (await guestSignin());
        if (!t) throw new Error('no session');
        const r = await gameCreate(t, {
          name: `Test game ${new Date().toLocaleString()}`,
          mode: 'test',
          config: {
            board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
            apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 2,
            bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'easy' }],
          },
        });
        navigate(`/lobby/${r.gameId}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to create test game');
      }
    })();
  }, [token, guestSignin, navigate]);

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  return <main className="page"><p>Setting up your test game…</p></main>;
}
