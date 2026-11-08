import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <main className="landing">
      <h1>Tank Turn Tactics</h1>
      <p className="tagline">Alliances. Betrayal. Last tank standing.</p>
      <nav className="menu">
        <Link className="menu-item" data-testid="btn-play" to="/auth">Play</Link>
        <Link className="menu-item" data-testid="btn-instructions" to="/instructions">Instructions</Link>
        <Link className="menu-item" data-testid="btn-test" to="/test">Test Mode</Link>
      </nav>
    </main>
  );
}
