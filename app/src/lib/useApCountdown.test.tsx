import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useApCountdown } from './useApCountdown';
import type { GameState } from '@ttt/engine';

const BASE_STATE: GameState = {
  seq: 1,
  day: 1,
  tickClockMinutes: 0,
  config: {
    seed: 1,
    board: 8,
    startingHp: 3,
    startingAp: 0,
    baseRange: 2,
    apPerDay: 1,
    upgradeCost: 2,
    apIntervalMinutes: 30,
    revives: false,
    juryHaunt: false,
  },
  players: {},
  order: [],
  pendingVotes: [],
  jury: [],
  winner: null,
  log: [],
};

// minimal GameDetail['game'] stand-in — the hook only reads status + lastTickAt
function detail(over: Record<string, unknown> = {}) {
  return {
    id: 'g1', name: 'n', mode: 'play', status: 'active', config: {},
    createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null,
    lastTickAt: null, dailyApTime: null, ...over,
  } as never;
}

afterEach(() => vi.useRealTimers());

describe('useApCountdown', () => {
  test('interval game: seconds remaining until the next grant, ticking down', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    // last tick 10 minutes ago on a 30-minute interval → 20:00 left
    const { result } = renderHook(() =>
      useApCountdown(BASE_STATE, detail({ lastTickAt: '2026-11-15T11:50:00Z' })),
    );
    expect(result.current).toBe(20 * 60);
    // one second later: 19:59 left
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(20 * 60 - 1);
  });

  test('interval game: grant boundary holds at 0 until a refetch confirms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    const { result, rerender } = renderHook(
      ({ lastTickAt }: { lastTickAt: string | null }) =>
        useApCountdown(BASE_STATE, detail({ lastTickAt })),
      { initialProps: { lastTickAt: '2026-11-15T11:30:00Z' } },
    );
    // exactly one full interval elapsed → 0, and it HOLDS at 0 (no rollover
    // guesswork while cron jitter may delay the real grant)
    expect(result.current).toBe(0);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(0);
    // a refetch brings a NEW lastTickAt → the hold clears and the countdown
    // restarts from the confirmed grant (a timestamp a hair ahead of the
    // client clock clamps to a full interval, never more)
    rerender({ lastTickAt: '2026-11-15T12:00:30Z' });
    expect(result.current).toBe(30 * 60);
  });

  test('interval game without a server tick yet: counts to the top of the minute', () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-15T12:00:17Z');
    vi.setSystemTime(now);
    const { result } = renderHook(() =>
      useApCountdown(BASE_STATE, detail({ lastTickAt: null })),
    );
    // the server grants on its next cron fire, so the first countdown runs
    // to the top of the minute, not gameStart + interval
    expect(result.current).toBe(43);
  });

  test('before the first active detail loads: null (no base to count from)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:17Z'));
    // render with a pending (non-active) detail first, then go active — the
    // "client first saw active" base is only stamped once
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useApCountdown(BASE_STATE, detail({ status, lastTickAt: null })),
      { initialProps: { status: 'pending' } },
    );
    expect(result.current).toBeNull();
    rerender({ status: 'active' });
    // the started-at base is stamped by the ref effect once the detail turns
    // active; the next interval tick (≤1s later) picks it up at call time
    await act(async () => { vi.advanceTimersByTime(1000); });
    // 1s of fake time also elapsed → 12:00:18 → 42s to the top of the minute
    expect(result.current).toBe(42);
  });

  test('random schedule: no public countdown (the grant minute is secret)', () => {
    const state = {
      ...BASE_STATE,
      config: { ...BASE_STATE.config, apSchedule: 'random' as const, apIntervalMinutes: 30 },
    };
    const { result } = renderHook(() =>
      useApCountdown(state, detail({ lastTickAt: '2026-11-15T11:50:00Z' })),
    );
    expect(result.current).toBeNull();
  });

  test('finished game: null', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useApCountdown(
        { ...BASE_STATE, winner: 'p1' },
        detail({ status: 'finished', lastTickAt: '2026-11-15T11:50:00Z' }),
      ),
    );
    expect(result.current).toBeNull();
  });

  test('no interval and no time-of-day: null', () => {
    const state = { ...BASE_STATE, config: { ...BASE_STATE.config, apIntervalMinutes: 0 } };
    const { result } = renderHook(() =>
      useApCountdown(state, detail({ lastTickAt: '2026-11-15T11:50:00Z' })),
    );
    expect(result.current).toBeNull();
  });

  test('time-of-day schedule: counts to the next slot in the schedule timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    const state = {
      ...BASE_STATE,
      config: {
        ...BASE_STATE.config,
        apIntervalMinutes: 0,
        apSchedule: 'timeOfDay' as const,
        apTimeOfDay: '13:30',
        apTimezone: 'UTC',
      },
    };
    const { result } = renderHook(() => useApCountdown(state, detail({ lastTickAt: null })));
    // 12:00:00Z → next 13:30 slot is 1h30m away
    expect(result.current).toBe(90 * 60);
  });

  test('time-of-day schedule: a slot earlier today rolls to tomorrow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    const state = {
      ...BASE_STATE,
      config: {
        ...BASE_STATE.config,
        apIntervalMinutes: 0,
        apSchedule: 'timeOfDay' as const,
        apTimeOfDay: '09:00',
        apTimezone: 'UTC',
      },
    };
    const { result } = renderHook(() => useApCountdown(state, detail({ lastTickAt: null })));
    // 09:00 already passed today → next slot is tomorrow 09:00 (21h away)
    expect(result.current).toBe(21 * 3_600);
  });
});
