import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Auth() {
  const { signin, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) { setError('name must be at least 2 characters'); return; }
    if (password.length < 8) { setError('password must be at least 8 characters'); return; }
    setBusy(true);
    try {
      if (mode === 'signin') await signin(name, password);
      else await register(name, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <Link to="/" className="muted">← Back</Link>
      <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
      <div className="row" role="tablist">
        <button className={mode === 'signin' ? 'primary' : ''} onClick={() => setMode('signin')}>Sign in</button>
        <button className={mode === 'register' ? 'primary' : ''} onClick={() => setMode('register')}>Create account</button>
      </div>
      <form onSubmit={onSubmit} className="panel">
        <label htmlFor="name">Name</label>
        <input id="name" value={name} onChange={e => setName(e.target.value)}
          autoComplete="username" placeholder="2–24 characters" />
        <label htmlFor="password" style={{ marginTop: 12 }}>Password</label>
        <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="8+ characters" />
        <p className="error" role="alert">{error}</p>
        <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
