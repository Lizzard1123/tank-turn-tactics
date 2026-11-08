import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Landing() {
  const { player } = useAuth();
  return (
    <main className="landing">
      <h1>Tank Turn Tactics</h1>
      <p className="tagline">Alliances. Betrayal. Last tank standing.</p>
      <nav className="menu">
        <Link className="menu-item" data-testid="btn-play" to="/play">Play</Link>
        <Link className="menu-item" data-testid="btn-instructions" to="/instructions">Instructions</Link>
        <Link className="menu-item" data-testid="btn-test" to="/test">Test Mode</Link>
        {player && (
          <>
            <Link className="menu-item" data-testid="btn-dashboard" to="/dashboard">Dashboard</Link>
            <Link className="menu-item" data-testid="btn-profile" to="/profile">Profile</Link>
          </>
        )}
      </nav>
    </main>
  );
}
