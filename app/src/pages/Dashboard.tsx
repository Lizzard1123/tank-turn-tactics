import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { gameList, gameCreate, gameJoin, gameDelete, type GameSummary } from '../lib/api';
import { Icon, trashSvg, clipboardSvg } from '../lib/icons';
import { ErrorBlock, LoadingBlock } from '../components/Status';

export default function Dashboard() {
  const { token, player, isGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'play' | 'test'>('play');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [finishedOpen, setFinishedOpen] = useState(false);

  const loadGames = useCallback(async () => {
    if (!token) return;
    try {
      const r = await gameList(token);
      setGames(r.games);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load games');
    }
  }, [token]);

  useEffect(() => { void loadGames(); }, [loadGames]);

  // support ?join=CODE deep-link from a shared invite
  const joinParam = new URLSearchParams(location.search).get('join');
  const [autoJoined, setAutoJoined] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !joinParam || joinParam === autoJoined) return;
    // guests never join from the client — send them to register instead
    if (isGuest) {
      navigate('/auth', { replace: true });
      return;
    }
    setAutoJoined(joinParam);
    gameJoin(token, joinParam)
      .then((r) => navigate(`/game/${r.gameId}`, { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : 'join failed'));
  }, [token, isGuest, joinParam, autoJoined, navigate]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const config = mode === 'test'
        ? { board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 5 }
        : { board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2 };
      const r = await gameCreate(token, { name: name.trim(), mode, config });
      // the server auto-members the creator, and the lobby displays the invite
      // code — go straight in instead of parking on an intermediate box
      navigate(`/lobby/${r.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !invite.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await gameJoin(token, invite.trim());
      navigate(`/game/${r.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'join failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(gameId: string, gameName: string) {
    if (!token || !window.confirm(`Delete "${gameName}"? This cannot be undone.`)) return;
    setDeleting(gameId);
    try {
      await gameDelete(token, gameId);
      await loadGames();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setDeleting(null);
    }
  }

  // Shared by the active list and the finished-games expander — the delete rule
  // (host test games incl. finished ones, plus host lobby games) is identical.
  function GameRow({ g }: { g: GameSummary }) {
    return (
      <>
        <button
          className="game-link"
          onClick={() => navigate(g.status === 'lobby' ? `/lobby/${g.id}` : `/game/${g.id}`)}
        >
          <span className="game-name">{g.name}</span>
          <span className="game-meta">{g.mode} · {g.status} · {g.playerCount} players</span>
        </button>
        {g.createdBy === player?.id && (g.mode === 'test' || g.status === 'lobby') && (
          <button
            className="game-delete"
            onClick={() => handleDelete(g.id, g.name)}
            disabled={deleting === g.id}
            aria-label={`Delete ${g.name}`}
          >
            <Icon html={trashSvg} width={20} height={20} />
          </button>
        )}
      </>
    );
  }

  const activeGames = games?.filter((g) => g.status === 'lobby' || g.status === 'active') ?? null;
  const finishedGames = games?.filter((g) => g.status !== 'lobby' && g.status !== 'active') ?? null;

  return (
    <main className="page">
      <p className="row" style={{ justifyContent: 'space-between' }}>
        <Link to="/" className="link-button btn">← Home</Link>
        <span className="row" style={{ gap: 8 }}>
          <Link to="/config" className="link-button btn" data-testid="nav-config" aria-label="Game config">
            <Icon html={clipboardSvg} width={14} height={14} /> Config
          </Link>
          <Link to="/profile" className="link-button btn">Profile</Link>
        </span>
      </p>
      <h1>Games</h1>
      <p className="subtitle">Hi {player?.name} — start or join a game.</p>
      {isGuest && (
        <p className="muted guest-hint">
          Playing as {player?.name} — a temporary guest tied to this browser.{' '}
          <Link to="/auth">Register to keep a name and your games.</Link>
        </p>
      )}

      <section className="card" aria-label="Your games">
        <h2>Your games</h2>
        {error && <ErrorBlock message={error} />}
        {games === null && !error && <LoadingBlock label="Loading games…" />}
        {activeGames?.length === 0 && !finishedGames?.length && (
          <p>No games yet — create or join one below.</p>
        )}
        <ul className="game-list">
          {activeGames?.map((g) => (
            <li key={g.id} className="game-row">
              <GameRow g={g} />
            </li>
          ))}
        </ul>
        {finishedGames && finishedGames.length > 0 && (
          <details className="finished-games" open={finishedOpen}>
            <summary
              data-testid="finished-games-toggle"
              onClick={(e) => { e.preventDefault(); setFinishedOpen((v) => !v); }}
            >
              Finished games ({finishedGames.length})
            </summary>
            {finishedOpen && (
              <ul className="game-list">
                {finishedGames.map((g) => (
                  <li key={g.id} className="game-row" data-testid={`finished-game-${g.id}`}>
                    <GameRow g={g} />
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </section>

      <section className="card" aria-label="Create game">
        <h2>Create game</h2>
        <form onSubmit={handleCreate}>
          <label htmlFor="game-name">Game name</label>
          <input id="game-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} />
          <fieldset>
            <legend>Mode</legend>
            <label><input type="radio" name="mode" value="play" checked={mode === 'play'} onChange={() => setMode('play')} /> Play (async daily)</label>
            <label><input type="radio" name="mode" value="test" checked={mode === 'test'} onChange={() => setMode('test')} /> Test (private, fast ticks)</label>
          </fieldset>
          <button type="submit" disabled={busy}>Create</button>
        </form>
      </section>

      <section className="card" aria-label="Join game">
        <h2>Join game</h2>
        {isGuest ? (
          <p className="muted">Guests can't join shared games — <Link to="/auth">register</Link> first.</p>
        ) : (
          <form onSubmit={handleJoin}>
            <label htmlFor="invite-code">Invite code</label>
            <input id="invite-code" value={invite} onChange={(e) => setInvite(e.target.value)} required />
            <button type="submit" disabled={busy}>Join</button>
          </form>
        )}
      </section>
    </main>
  );
}
