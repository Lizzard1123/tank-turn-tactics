import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './auth';
import * as api from './api';

vi.mock('./api', () => ({
  register: vi.fn(),
  signin: vi.fn(),
}));

function probe() {
  const out: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
  function Probe() {
    out.auth = useAuth();
    return null;
  }
  render(<AuthProvider><Probe /></AuthProvider>);
  return out;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('auth context', () => {
  test('register stores session', async () => {
    vi.mocked(api.register).mockResolvedValue({ token: 't1', player: { id: 'p1', name: 'a' } });
    const { auth } = probe();
    await act(async () => { await auth!.register('a', 'longenough'); });
    expect(localStorage.getItem('ttt_token')).toBe('t1');
    expect(JSON.parse(localStorage.getItem('ttt_player')!)).toEqual({ id: 'p1', name: 'a' });
  });

  test('signin stores session', async () => {
    vi.mocked(api.signin).mockResolvedValue({ token: 't2', player: { id: 'p2', name: 'b' } });
    const { auth } = probe();
    await act(async () => { await auth!.signin('b', 'longenough'); });
    expect(localStorage.getItem('ttt_token')).toBe('t2');
  });

  test('signout clears session', async () => {
    vi.mocked(api.register).mockResolvedValue({ token: 't1', player: { id: 'p1', name: 'a' } });
    const { auth } = probe();
    await act(async () => { await auth!.register('a', 'longenough'); });
    act(() => { auth!.signout(); });
    expect(localStorage.getItem('ttt_token')).toBeNull();
  });

  test('guestSignin creates session once and reuses it', async () => {
    vi.mocked(api.register).mockResolvedValue({ token: 'tg', player: { id: 'g1', name: 'guest-x' } });
    const first = probe();
    await act(async () => { await first.auth!.guestSignin(); });
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ttt_guest')).toBe('1');
    // second probe (fresh mount) reuses the guest session without re-registering
    const second = probe();
    await act(async () => { await second.auth!.guestSignin(); });
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(second.auth!.player?.id).toBe('g1');
  });
});
