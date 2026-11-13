import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { useGameEvents } from './useGameEvents';
import * as api from './api';

vi.mock('./api', () => ({
  gameGet: vi.fn(),
}));

// capture the realtime channel wiring without a real client
const h = vi.hoisted(() => ({
  channelMock: vi.fn(),
  channelOn: vi.fn(),
  channelSubscribe: vi.fn(),
  removeChannel: vi.fn(),
  setAuth: vi.fn(),
}));
vi.mock('./supabaseClient', () => ({
  supabase: {
    channel: h.channelMock,
    removeChannel: h.removeChannel,
    realtime: { setAuth: h.setAuth },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('ttt_token', 'tok-test');
  h.channelMock.mockReturnValue({ on: h.channelOn, subscribe: h.channelSubscribe });
  h.channelOn.mockReturnValue({ subscribe: h.channelSubscribe });
});

// minimal fake engine types — the hook replays events through @ttt/engine
const BASE_STATE = {
  seq: 0, day: 1, tickClockMinutes: 0, config: {
    seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
    apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
  },
  players: {
    p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 5, range: 2, isBot: false, botDifficulty: null },
    p2: { id: 'p2', name: 'foe', pos: { x: 3, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
  },
  order: ['p1', 'p2'], pendingVotes: [], jury: [], winner: null, log: [],
};

function detail(over: Record<string, unknown> = {}) {
  return {
    game: { id: 'g1', name: 'n', mode: 'play' as const, status: 'active' as const, config: BASE_STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null, lastTickAt: null, dailyApTime: '09:00', ...over },
    members: [],
    avatars: {},
    names: {},
    me: 'p1',
  };
}

function HookProbe({ expose }: { expose?: (g: ReturnType<typeof useGameEvents>) => void }) {
  const g = useGameEvents('g1');
  expose?.(g);
  return (
    <div>
      <div data-testid="seq">{g.state?.seq ?? 'none'}</div>
      <div data-testid="error">{g.error ?? ''}</div>
      <div data-testid="loading">{String(g.loading)}</div>
      <div data-testid="status">{g.detail?.status ?? ''}</div>
      <div data-testid="histlen">{g.history.length}</div>
      <button onClick={() => g.refresh()}>refresh</button>
    </div>
  );
}

function realtimeCallback(): (payload: unknown) => void {
  const call = h.channelOn.mock.calls.find(c => c[0] === 'postgres_changes');
  if (!call) throw new Error('no postgres_changes wiring');
  return call[2] as (payload: unknown) => void;
}

describe('useGameEvents', () => {
  test('exposes replayed state from game-get detail', async () => {
    // server snapshot at seq 5 plus two tail events
    const ev = (seq: number, to: { x: number; y: number }) => ({
      seq, type: 'move', actorId: 'p1', createdAt: 't', payload: { to },
    });
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 5 },
      events: [ev(6, { x: 1, y: 0 }), ev(7, { x: 1, y: 1 })],
      history: [],
    });
    render(<HookProbe />);
    // after replay of the tail onto the snapshot, seq = 7
    expect(await screen.findByTestId('seq')).toHaveTextContent('7');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  test('subscribes to player_activity and applies the row directly', async () => {
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 5 },
      events: [],
      history: [],
    });
    render(<HookProbe />);
    await screen.findByTestId('seq');
    expect(h.channelMock).toHaveBeenCalledWith(`state:g1`);
    expect(h.channelSubscribe).toHaveBeenCalled();
    expect(h.setAuth).toHaveBeenCalledWith('tok-test'); // token attached for RLS

    const call = h.channelOn.mock.calls.find(c => c[0] === 'postgres_changes');
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ event: '*', table: 'player_activity', filter: 'game_id=eq.g1' });

    // a realtime row applies DIRECTLY — no refetch
    const callsBefore = vi.mocked(api.gameGet).mock.calls.length;
    act(() => realtimeCallback()({
      new: {
        game_id: 'g1', player_id: 'p1', seq: 6,
        state: { ...BASE_STATE, seq: 6, day: 2 },
        events: [{ seq: 6, type: 'daily_tick', actorId: 'system', createdAt: 't', payload: {}, generation: 1 }],
        game_patch: { lastTickAt: '2026-01-01T00:00:00Z' },
      },
    }));
    await act(async () => {});
    expect(screen.getByTestId('seq')).toHaveTextContent('6');
    expect(screen.getByTestId('histlen')).toHaveTextContent('1');
    expect(vi.mocked(api.gameGet).mock.calls.length).toBe(callsBefore); // no refetch
  });

  test('stale and foreign rows are ignored', async () => {
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 5 },
      events: [],
      history: [],
    });
    render(<HookProbe />);
    await screen.findByTestId('seq');

    // foreign member row (RLS should prevent it — belt and braces)
    act(() => realtimeCallback()({
      new: { game_id: 'g1', player_id: 'p2', seq: 9, state: { ...BASE_STATE, seq: 9 } },
    }));
    expect(screen.getByTestId('seq')).toHaveTextContent('5');

    // out-of-order / stale row for this member
    act(() => realtimeCallback()({
      new: { game_id: 'g1', player_id: 'p1', seq: 4, state: { ...BASE_STATE, seq: 4 } },
    }));
    expect(screen.getByTestId('seq')).toHaveTextContent('5');

    // wrong game (the subscription is filtered, but the handler guards too)
    act(() => realtimeCallback()({
      new: { game_id: 'other', player_id: 'p1', seq: 9, state: { ...BASE_STATE, seq: 9 } },
    }));
    expect(screen.getByTestId('seq')).toHaveTextContent('5');
  });

  test('history append dedupes against refreshed history', async () => {
    const move6 = { seq: 6, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 };
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 5 },
      events: [],
      history: [],
    });
    let hook: ReturnType<typeof useGameEvents> | undefined;
    render(<HookProbe expose={(g) => { hook = g; }} />);
    await screen.findByTestId('seq');

    act(() => realtimeCallback()({
      new: { game_id: 'g1', player_id: 'p1', seq: 6, state: { ...BASE_STATE, seq: 6 }, events: [move6] },
    }));
    expect(screen.getByTestId('histlen')).toHaveTextContent('1');

    // a refresh that lands afterwards carries the same event — appending it
    // again must not duplicate the row
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 6 },
      events: [],
      history: [move6],
    });
    await act(async () => { await hook!.refresh(); });
    expect(screen.getByTestId('histlen')).toHaveTextContent('1');

    // and the realtime row replaying the same seq is dropped by the seq guard
    act(() => realtimeCallback()({
      new: { game_id: 'g1', player_id: 'p1', seq: 6, state: { ...BASE_STATE, seq: 6 }, events: [move6] },
    }));
    expect(screen.getByTestId('histlen')).toHaveTextContent('1');
  });

  test('game_patch merges into detail without a refetch', async () => {
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 5 },
      events: [],
      history: [],
    });
    render(<HookProbe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'));

    act(() => realtimeCallback()({
      new: {
        game_id: 'g1', player_id: 'p1', seq: 6,
        state: { ...BASE_STATE, seq: 6, winner: 'p2' },
        game_patch: { status: 'finished' },
      },
    }));
    expect(screen.getByTestId('status')).toHaveTextContent('finished');
    const callsBefore = vi.mocked(api.gameGet).mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);
  });

  test('a refresh that raced a direct-apply does not drag the board back', async () => {
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 5 },
      events: [],
      history: [],
    });
    let hook: ReturnType<typeof useGameEvents> | undefined;
    render(<HookProbe expose={(g) => { hook = g; }} />);
    await screen.findByTestId('seq');

    // realtime row lands at seq 8
    act(() => realtimeCallback()({
      new: { game_id: 'g1', player_id: 'p1', seq: 8, state: { ...BASE_STATE, seq: 8 } },
    }));
    expect(screen.getByTestId('seq')).toHaveTextContent('8');

    // an in-flight fetch that started before the commit resolves with seq 7
    vi.mocked(api.gameGet).mockResolvedValue({
      ...detail(),
      state: { ...BASE_STATE, seq: 7 },
      events: [],
      history: [],
    });
    await act(async () => { await hook!.refresh(); });
    expect(screen.getByTestId('seq')).toHaveTextContent('8'); // not dragged back
  });

  test('poller cadence: 4s while socket is down, 15s while joined', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.gameGet).mockResolvedValue({
        ...detail(),
        state: { ...BASE_STATE, seq: 5 },
        events: [],
        history: [],
      });
      render(<HookProbe />);
      await act(async () => {}); // initial load: 1 call
      const calls = () => vi.mocked(api.gameGet).mock.calls.length;
      expect(calls()).toBe(1);

      // socket NOT joined: 4s cadence (advance in chunks so each tick's
      // async refresh completes before the next timer fires — the in-flight
      // dedupe would otherwise swallow the second tick)
      await act(async () => { vi.advanceTimersByTime(4500); });
      await act(async () => { vi.advanceTimersByTime(4500); });
      expect(calls()).toBeGreaterThanOrEqual(3); // polls at ~4s and ~8s
      const afterUnhealthy = calls();

      // subscribe reports SUBSCRIBED -> back off to 15s
      const statusCb = h.channelSubscribe.mock.calls.at(-1)?.[0] as ((s: string) => void) | undefined;
      expect(typeof statusCb).toBe('function');
      act(() => statusCb!('SUBSCRIBED'));
      await act(async () => { vi.advanceTimersByTime(14000); });
      expect(calls()).toBe(afterUnhealthy); // no poll within the first 14s
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(calls()).toBe(afterUnhealthy + 1); // one poll at the 15s mark

      // socket drops -> back to 4s
      act(() => statusCb!('CHANNEL_ERROR'));
      await act(async () => { vi.advanceTimersByTime(4500); });
      await act(async () => { vi.advanceTimersByTime(4500); });
      expect(calls()).toBeGreaterThanOrEqual(afterUnhealthy + 3); // ~4s and ~8s
    } finally {
      vi.useRealTimers();
    }
  });
});
