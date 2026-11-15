import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Auth from './Auth';
import { AuthProvider } from '../lib/auth';
import { supabase } from '../lib/supabaseClient';

// The Auth page drives the REAL auth context (mocked GoTrue underneath), so
// these tests cover the full submit path: name/password -> context method ->
// GoTrue call -> navigate('/games') or the rendered error. The mock mirrors
// the supabase-js contract: subscribe -> INITIAL_SESSION, and sign-in calls
// emit SIGNED_IN before they resolve (which is what triggers the context to
// resolve the players row and unblock the RequireAuth gate on /games).

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(),
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInAnonymously: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

let authCallback: ((event: string, session: unknown) => void) | null = null;
let currentSession: { access_token: string; user: { id: string; is_anonymous?: boolean } } | null = null;
let playerRow: { id: string; name: string } | null = null;
let signInError: Error | null = null;
let signUpError: Error | null = null;
let nameTaken = false;

const fireAuth = (event: string, session: unknown = currentSession) => authCallback?.(event, session);
const sessionOf = (name: string) => ({
  access_token: `tok-${name}`,
  user: { id: `uid-${name}`, is_anonymous: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  authCallback = null;
  currentSession = null;
  playerRow = null;
  signInError = null;
  signUpError = null;
  nameTaken = false;

  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((cb: never) => {
    authCallback = cb as typeof authCallback;
    // mirror supabase-js: INITIAL_SESSION lands right after subscribe
    queueMicrotask(() => fireAuth('INITIAL_SESSION'));
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }) as never);
  vi.mocked(supabase.auth.getSession).mockImplementation(async () => ({
    data: { session: currentSession },
  }) as never);
  vi.mocked(supabase.auth.getUser).mockImplementation(async () => ({
    data: { user: currentSession?.user ?? null },
  }) as never);
  vi.mocked(supabase.auth.signInWithPassword).mockImplementation(async (args: Record<string, unknown>) => {
    // supabase-js RESOLVES with { error } — it does not throw
    if (signInError) return { data: {}, error: signInError } as never;
    const name = String(args.email).split('@')[0];
    currentSession = sessionOf(name);
    playerRow = { id: `uid-${name}`, name };
    fireAuth('SIGNED_IN', currentSession);
    return { data: { session: currentSession, user: currentSession.user } } as never;
  });
  vi.mocked(supabase.auth.signUp).mockImplementation(async (args: Record<string, unknown>) => {
    if (signUpError) return { data: {}, error: signUpError } as never;
    // local GoTrue auto-confirms: signUp lands a live session + SIGNED_IN
    const name = String(args.email).split('@')[0];
    currentSession = sessionOf(name);
    playerRow = { id: `uid-${name}`, name };
    fireAuth('SIGNED_IN', currentSession);
    return { data: { session: currentSession, user: currentSession.user }, error: null } as never;
  });
  vi.mocked(supabase.rpc).mockImplementation((() => ({ data: nameTaken, error: null })) as never);
  vi.mocked(supabase.from).mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: playerRow, error: playerRow ? null : { message: 'no rows' } }) }) }),
  }) as never);
});

function renderAuth() {
  return render(
    <MemoryRouter initialEntries={['/auth']}>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/games" element={<div>GAMES PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// the tab toggle and the submit button share the "Sign in" label — pick the
// form's actual submit button
const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;

const fill = (name: string, password: string) => {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
};

describe('Auth page — sign in', () => {
  test('valid credentials sign in and navigate to /games', async () => {
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    fill('me', 'longenough1');
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText('GAMES PAGE')).toBeInTheDocument());
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'me@players.tank-turn.game', password: 'longenough1',
    });
  });

  test('wrong credentials render the friendly error, no navigation', async () => {
    signInError = new Error('Invalid login credentials');
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    fill('me', 'wrong-pass');
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/wrong name or password/i),
    );
    expect(screen.queryByText('GAMES PAGE')).not.toBeInTheDocument();
  });

  test('client-side validation: short name and short password never reach GoTrue', async () => {
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    fill('a', 'longenough1'); // name too short
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 2 characters/i);
    fill('me', 'short'); // password too short
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8|8\+ characters/i);
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  test('busy submit disables the button until the GoTrue round-trip lands', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(supabase.auth.signInWithPassword).mockImplementation(
      (() => new Promise((r: (v: never) => void) => { release = r as typeof release; })) as never,
    );
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    fill('me', 'longenough1');
    fireEvent.click(submitButton());
    const busy = submitButton();
    expect(busy).toBeDisabled();
    release({ data: {} });
    await waitFor(() => expect(busy).toBeEnabled());
  });
});

describe('Auth page — register', () => {
  const switchToRegister = async () => {
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    // the heading is unambiguous (tab and submit share the "Create account" label)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument(),
    );
  };

  test('register calls signUp with the synthetic email and navigates', async () => {
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    await switchToRegister();
    fill('Newbie', 'longenough1');
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText('GAMES PAGE')).toBeInTheDocument());
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'newbie@players.tank-turn.game',
      password: 'longenough1',
      options: { data: { name: 'Newbie' } },
    });
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled(); // register ≠ sign-in
  });

  test('a taken name is rejected before signUp fires', async () => {
    nameTaken = true;
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    await switchToRegister();
    fill('taken', 'longenough1');
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/name taken/i));
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  test('duplicate-email signUp is translated to "name taken"', async () => {
    signUpError = new Error('User already registered');
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toBeInTheDocument());
    await switchToRegister();
    fill('dupe', 'longenough1');
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/name taken/i));
  });

  test('mode toggle swaps the heading', async () => {
    renderAuth();
    await waitFor(() => expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument(),
    );
  });
});
