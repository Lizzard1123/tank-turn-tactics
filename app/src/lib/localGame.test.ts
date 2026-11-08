import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLocalGame } from './localGame';

describe('localGame history', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  function stepFrom(game: ReturnType<typeof createLocalGame>) {
    const p = game.state().players['me'].pos;
    // move 1 orthogonal square into a free cell (board is 8x8, 4 players)
    const candidates = [
      { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 },
    ];
    const occ = new Set(Object.values(game.state().players).map((q) => `${q.pos.x},${q.pos.y}`));
    return candidates.find((c) => c.x >= 0 && c.y >= 0 && c.x < 8 && c.y < 8 && !occ.has(`${c.x},${c.y}`))!;
  }

  test('records every applied event (player + drip) in history', () => {
    const game = createLocalGame({ startingAp: 4 });
    game.startApDrip(30_000);
    game.apply('move', { to: stepFrom(game) });
    vi.advanceTimersByTime(30_000);
    expect(game.history.length).toBe(2); // player move, then drip tick
    expect(game.history[0].type).toBe('move');
    expect(game.history[1].type).toBe('daily_tick');
  });

  test('replayTo(n) returns the state after the first n events', () => {
    const game = createLocalGame({ startingAp: 4 });
    game.apply('move', { to: stepFrom(game) });
    const after1 = game.state().players['me'].pos;
    game.apply('move', { to: stepFrom(game) });
    const after2 = game.state().players['me'].pos;
    const s1 = game.replayTo(1);
    expect(s1.players['me'].pos).toEqual(after1);
    expect(s1.seq).toBe(1);
    const s2 = game.replayTo(2);
    expect(s2.players['me'].pos).toEqual(after2);
  });

  test('replayTo(0) is the initial state; replayTo(>len) is current state', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.replayTo(0).players['me'].ap).toBe(4);
    game.apply('upgrade_range', {});
    expect(game.replayTo(99).players['me'].range).toBe(3);
  });
});
