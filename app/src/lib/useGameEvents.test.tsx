import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

function HookProbe() {
  const g = useGameEvents('g1');
  return (
    <div>
      <div data-testid="seq">{g.state?.seq ?? 'none'}</div>
      <div data-testid="error">{g.error ?? ''}</div>
      <div data-testid="loading">{String(g.loading)}</div>
      <button onClick={() => g.refresh()}>refresh</button>
    </div>
  );
}

describe('useGameEvents', () => {
  test('exposes replayed state from game-get detail', async () => {
    // server snapshot at seq 5 plus two tail events
    const ev = (seq: number, to: { x: number; y: number }) => ({
      seq, type: 'move', actorId: 'p1', createdAt: 't', payload: { to },
    });
    vi.mocked(api.gameGet).mockResolvedValue({
      game: { id: 'g1', name: 'n', mode: 'play', status: 'active', config: BASE_STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null },
      state: { ...BASE_STATE, seq: 5 },
      events: [ev(6, { x: 1, y: 0 }), ev(7, { x: 1, y: 1 })],
      history: [],
      members: [],
      me: 'p1',
    });
    render(<HookProbe />);
    // after replay of the tail onto the snapshot, seq = 7
    expect(await screen.findByTestId('seq')).toHaveTextContent('7');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  test('realtime INSERT triggers refresh', async () => {
    vi.mocked(api.gameGet).mockResolvedValue({
      game: { id: 'g1', name: 'n', mode: 'play', status: 'active', config: BASE_STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null },
      state: { ...BASE_STATE, seq: 0 },
      events: [],
      history: [],
      members: [],
      me: 'p1',
    });
    render(<HookProbe />);
    await screen.findByTestId('seq');
    expect(h.channelMock).toHaveBeenCalledWith(`events:g1`);
    expect(h.channelSubscribe).toHaveBeenCalled();
    expect(h.setAuth).toHaveBeenCalledWith('tok-test'); // token attached for RLS

    // fire the activity-row callback the wiring registered (the realtime
    // trigger moved from `events` INSERT to `activity` INSERT/UPDATE —
    // secrecy: members must not read raw event rows)
    const call = h.channelOn.mock.calls.find(c => c[0] === 'postgres_changes');
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ event: '*', table: 'activity', filter: 'game_id=eq.g1' });
    const cb = call![2] as (payload: unknown) => void;

    const callsBefore = vi.mocked(api.gameGet).mock.calls.length;
    act(() => cb({}));
    await act(async () => {});
    expect(vi.mocked(api.gameGet).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
