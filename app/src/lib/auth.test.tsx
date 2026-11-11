import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth';
import { supabase } from './supabaseClient';

// The auth context is a thin shell over supabase-js GoTrue: this suite mocks
// the client and drives the same onAuthStateChange contract the real library
// uses (INITIAL_SESSION right after subscribe, SIGNED_IN after auth calls).
vi.mock('./supabaseClient', () => ({
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

type AuthCallback = (event: string, session: unknown) => Promise<void> | void;
let authCallback: AuthCallback | null = null;

async function probe() {
  const out: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
  function Probe() {
    out.auth = useAuth();
    return null;
  }
  // the provider renders nothing until INITIAL_SESSION restore lands, so the
  // render itself must be inside act to flush that microtask
  await act(async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
  });
  return out;
}

// point getSession/getUser and the players row at a signed-in user.
// Call AFTER probe() — stubbing first would make the mount itself restore.
function stubSession(token: string, userId: string, name: string, anon = false) {
  const session = { access_token: token, user: { id: userId } };
  vi.mocked(supabase.auth.getSession).mockResolvedValue(
    { data: { session }, error: null } as never);
  vi.mocked(supabase.auth.getUser).mockResolvedValue(
    { data: { user: { id: userId, is_anonymous: anon } }, error: null } as never);
  vi.mocked(supabase.from).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { id: userId, name }, error: null }),
      }),
    }),
  }) as never);
  return session;
}

// real supabase-js emits SIGNED_IN after a successful auth call; the provider
// re-resolves the session from that event, so the mocks replay the event
function fireSignIn(session: { access_token: string }) {
  return authCallback!('SIGNED_IN', session);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  authCallback = null;
  // signed-out default: nothing on restore, no player row, names available
  vi.mocked(supabase.auth.getSession).mockResolvedValue(
    { data: { session: null }, error: null } as never);
  vi.mocked(supabase.auth.getUser).mockResolvedValue(
    { data: { user: null }, error: null } as never);
  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb) => {
    authCallback = cb as AuthCallback;
    // supabase-js fires INITIAL_SESSION immediately after subscribing
    queueMicrotask(() => { void cb('INITIAL_SESSION', null); });
    return { data: { subscription: { unsubscribe: vi.fn() } } } as never;
  });
  vi.mocked(supabase.rpc).mockResolvedValue({ data: false, error: null } as never);
  vi.mocked(supabase.from).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null, error: { message: 'no row' } }),
      }),
    }),
  }) as never);
});

describe('auth context', () => {
  test('signin stores the session', async () => {
    const out = await probe();
    const session = stubSession('t1', 'p1', 'abc');
    vi.mocked(supabase.auth.signInWithPassword).mockImplementation(async () => {
      await fireSignIn(session);
      return { data: { user: null, session }, error: null } as never;
    });
    await act(async () => { await out.auth!.signin('abc', 'longenough'); });
    expect(localStorage.getItem('ttt_token')).toBe('t1');
    expect(JSON.parse(localStorage.getItem('ttt_player')!)).toEqual({ id: 'p1', name: 'abc' });
  });

  test('signin maps invalid credentials to a friendly message', async () => {
    const out = await probe();
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue(
      { data: { user: null, session: null }, error: { message: 'Invalid login credentials', name: 'AuthApiError', status: 400 } } as never);
    await expect(act(async () => { await out.auth!.signin('abc', 'bad'); }))
      .rejects.toThrow('wrong name or password');
  });

  test('register rejects taken names before contacting auth', async () => {
    const out = await probe();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    await expect(act(() => out.auth!.register('abc', 'longenough')))
      .rejects.toThrow('name taken');
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  test('register signs up with the synthetic email and name metadata', async () => {
    const out = await probe();
    vi.mocked(supabase.auth.signUp).mockResolvedValue(
      { data: { user: { id: 'p1' }, session: null }, error: null } as never);
    await act(async () => { await out.auth!.register('A-1', 'longenough'); });
    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a-1@players.tank-turn.game',
        options: { data: { name: 'A-1' } },
      }),
    );
    // signUp resolving without a session must not mirror a bogus token
    expect(localStorage.getItem('ttt_token')).toBeNull();
  });

  test('register maps duplicate-email errors to "name taken"', async () => {
    const out = await probe();
    vi.mocked(supabase.auth.signUp).mockResolvedValue(
      { data: { user: null, session: null }, error: { message: 'User already registered', name: 'AuthApiError', status: 422 } } as never);
    await expect(act(() => out.auth!.register('abc', 'longenough')))
      .rejects.toThrow('name taken');
  });

  test('signout clears the mirrored session', async () => {
    const out = await probe();
    const session = stubSession('t1', 'p1', 'abc');
    vi.mocked(supabase.auth.signInWithPassword).mockImplementation(async () => {
      await fireSignIn(session);
      return { data: { user: null, session }, error: null } as never;
    });
    await act(async () => { await out.auth!.signin('abc', 'longenough'); });
    expect(localStorage.getItem('ttt_token')).toBe('t1');

    vi.mocked(supabase.auth.signOut).mockImplementation(async () => {
      await authCallback!('SIGNED_OUT', null);
      return { error: null } as never;
    });
    await act(async () => { await out.auth!.signout(); });
    expect(localStorage.getItem('ttt_token')).toBeNull();
    expect(localStorage.getItem('ttt_player')).toBeNull();
    expect(out.auth!.player).toBeNull();
  });

  test('guestSignin reuses a REAL player session instead of logging them out', async () => {
    // regression for the "test game logged me out" bug: calling
    // signInAnonymously over a live session REPLACES it (auth-js saves the
    // new session over the old one), destroying the signed-in identity.
    // guestSignin must return the existing token as-is.
    const out = await probe();
    stubSession('t1', 'p1', 'abc', false);
    let token = '';
    await act(async () => { token = await out.auth!.guestSignin(); });
    expect(token).toBe('t1');
    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  test('guestSignin creates one anonymous session when signed out and reuses it', async () => {
    const out = await probe();
    // signed-out default: getSession/getUser return null until the mock
    // sign-in below installs the anon session
    vi.mocked(supabase.auth.signInAnonymously).mockImplementation(async () => {
      const session = stubSession('tg', 'g1', 'guest-x', true);
      await fireSignIn(session);
      return { data: { user: null, session }, error: null } as never;
    });
    let token = '';
    await act(async () => { token = await out.auth!.guestSignin(); });
    expect(token).toBe('tg');
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ttt_token')).toBe('tg');
    expect(out.auth!.isGuest).toBe(true);

    // second call reuses the live guest session instead of creating another
    await act(async () => { token = await out.auth!.guestSignin(); });
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(token).toBe('tg');
    expect(out.auth!.player?.id).toBe('g1');
  });
});
