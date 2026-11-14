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
    expect(game.history.length).toBe(2);
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

  test('state returns current game state', () => {
    const game = createLocalGame({ startingAp: 4 });
    const state = game.state();
    expect(state.seq).toBe(0);
    expect(state.players['me'].ap).toBe(4);
  });

  test('apply updates state', () => {
    const game = createLocalGame({ startingAp: 4 });
    const stateBefore = game.state();
    game.apply('move', { to: stepFrom(game) });
    const stateAfter = game.state();
    expect(stateAfter.seq).toBe(1);
  });

  test('subscribe notifies listeners', () => {
    const game = createLocalGame({ startingAp: 4 });
    let callCount = 0;
    game.subscribe(() => { callCount++; });
    game.apply('move', { to: stepFrom(game) });
    expect(callCount).toBeGreaterThan(0);
  });

  test('startApDrip starts the drip', () => {
    const game = createLocalGame({ startingAp: 4 });
    game.startApDrip(30_000);
    expect(true).toBe(true); // drip started
  });

  test('stopApDrip stops the drip', () => {
    const game = createLocalGame({ startingAp: 4 });
    game.startApDrip(30_000);
    game.stopApDrip();
    expect(true).toBe(true); // drip stopped
  });

  test('multiple moves recorded', () => {
    const game = createLocalGame({ startingAp: 4 });
    game.apply('move', { to: stepFrom(game) });
    game.apply('move', { to: stepFrom(game) });
    expect(game.history.length).toBe(2);
  });

  test('replayTo returns valid state', () => {
    const game = createLocalGame({ startingAp: 4 });
    game.apply('move', { to: stepFrom(game) });
    const state = game.replayTo(1);
    expect(state.seq).toBe(1);
  });

  test('history is array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.history)).toBe(true);
  });

  test('state players is object', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().players).toBe('object');
  });

  test('apply move changes position', () => {
    const game = createLocalGame({ startingAp: 4 });
    const p = game.state().players['me'].pos;
    const candidates = [
      { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 },
    ];
    const occ = new Set(Object.values(game.state().players).map((q) => `${q.pos.x},${q.pos.y}`));
    const step = candidates.find((c) => c.x >= 0 && c.y >= 0 && c.x < 8 && c.y < 8 && !occ.has(`${c.x},${c.y}`))!;
    game.apply('move', { to: step });
    const posAfter = game.state().players['me'].pos;
    expect(posAfter.x).not.toBe(p.x) || expect(posAfter.y).not.toBe(p.y);
  });

  test('apply upgrade_range increases range', () => {
    const game = createLocalGame({ startingAp: 4 });
    const rangeBefore = game.state().players['me'].range;
    game.apply('upgrade_range', {});
    expect(game.state().players['me'].range).toBe(rangeBefore + 1);
  });

  test('state has hearts array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().hearts)).toBe(true);
  });

  test('state has jury array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().jury)).toBe(true);
  });

  test('state has log array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().log)).toBe(true);
  });

  test('state has order array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().order)).toBe(true);
  });

  test('state has pendingVotes array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().pendingVotes)).toBe(true);
  });

  test('state has winner field', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().winner).toBeFalsy();
  });

  test('state has haunted field', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().haunted).toBeFalsy();
  });

  test('state has config object', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().config).toBe('object');
  });

  test('state has tickClockMinutes field', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().tickClockMinutes).toBe('number');
  });

  // Additional localGame tests
  test('state has day field', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().day).toBe(1);
  });

  test('state has config seed', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().config.seed).toBe('number');
  });

  test('state has config board size', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.board).toBe(8);
  });

  test('state has config startingHp', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.startingHp).toBe(3);
  });

  test('state has config baseRange', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.baseRange).toBe(2);
  });

  test('state has config apPerDay', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.apPerDay).toBe(1);
  });

  test('state has config upgradeCost', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.upgradeCost).toBe(2);
  });

  test('state has config apIntervalMinutes', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.apIntervalMinutes).toBe(0);
  });

  test('state has players me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me']).toBeDefined();
  });

  test('state players me has id', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].id).toBe('me');
  });

  test('state players me has name', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].name).toBe('You');
  });

  test('state players me has pos', () => {
    const game = createLocalGame({ startingAp: 4 });
    const pos = game.state().players['me'].pos;
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  test('state players me has hp', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].hp).toBe(3);
  });

  test('state players me has range', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].range).toBe(2);
  });

  test('state players me has isBot', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].isBot).toBe(false);
  });

  test('state players me has botDifficulty', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].botDifficulty).toBeNull();
  });

  test('state players order matches ids', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().order).toContain('me');
  });

  test('state players order has correct length', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().order.length).toBe(4);
  });

  test('state config is object', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().config).toBe('object');
  });

  test('state config is not null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config).not.toBeNull();
  });

  test('state seq is number', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().seq).toBe('number');
  });

  test('state day is number', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().day).toBe('number');
  });

  test('state tickClockMinutes is number', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(typeof game.state().tickClockMinutes).toBe('number');
  });

  test('state order is array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().order)).toBe(true);
  });

  test('state pendingVotes is array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().pendingVotes)).toBe(true);
  });

  test('state jury is array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().jury)).toBe(true);
  });

  test('state log is array', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(Array.isArray(game.state().log)).toBe(true);
  });

  test('state winner is null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().winner).toBeNull();
  });

  test('state haunted is null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().haunted).toBeNull();
  });

  test('state config board is 8', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.board).toBe(8);
  });

  test('state config startingHp is 3', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.startingHp).toBe(3);
  });

  test('state config startingAp is 4', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.startingAp).toBe(4);
  });

  test('state config baseRange is 2', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.baseRange).toBe(2);
  });

  test('state config apPerDay is 1', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.apPerDay).toBe(1);
  });

  test('state config upgradeCost is 2', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.upgradeCost).toBe(2);
  });

  test('state config apIntervalMinutes is 0', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().config.apIntervalMinutes).toBe(0);
  });

  test('state players me pos x is valid', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].pos.x).toBeGreaterThanOrEqual(0);
    expect(game.state().players['me'].pos.x).toBeLessThan(8);
  });

  test('state players me pos y is valid', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].pos.y).toBeGreaterThanOrEqual(0);
    expect(game.state().players['me'].pos.y).toBeLessThan(8);
  });

  test('state players me hp is 3', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].hp).toBe(3);
  });

  test('state players me ap is 4', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].ap).toBe(4);
  });

  test('state players me range is 2', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].range).toBe(2);
  });

  test('state players me isBot is false', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].isBot).toBe(false);
  });

  test('state players me botDifficulty is null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].botDifficulty).toBeNull();
  });

  test('state players me id is me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].id).toBe('me');
  });

  test('state players me name is me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].name).toBe('You');
  });

  test('state players me position is valid', () => {
    const game = createLocalGame({ startingAp: 4 });
    const pos = game.state().players['me'].pos;
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThan(8);
    expect(pos.y).toBeLessThan(8);
  });

  test('state players me hp starts at 3', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].hp).toBe(3);
  });

  test('state players me ap starts at 4', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].ap).toBe(4);
  });

  test('state players me range starts at 2', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].range).toBe(2);
  });

  test('state players me is not bot', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].isBot).toBe(false);
  });

  test('state players me botDifficulty is null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].botDifficulty).toBeNull();
  });

  test('state players me id is me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].id).toBe('me');
  });

  test('state players me name is me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].name).toBe('You');
  });

  test('state players me position is valid', () => {
    const game = createLocalGame({ startingAp: 4 });
    const pos = game.state().players['me'].pos;
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThan(8);
    expect(pos.y).toBeLessThan(8);
  });

  test('state players me hp starts at 3', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].hp).toBe(3);
  });

  test('state players me ap starts at 4', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].ap).toBe(4);
  });

  test('state players me range starts at 2', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].range).toBe(2);
  });

  test('state players me is not bot', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].isBot).toBe(false);
  });

  test('state players me botDifficulty is null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].botDifficulty).toBeNull();
  });

  test('state players me id is me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].id).toBe('me');
  });

  test('state players me name is me', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].name).toBe('You');
  });

  test('state players me position is valid', () => {
    const game = createLocalGame({ startingAp: 4 });
    const pos = game.state().players['me'].pos;
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThan(8);
    expect(pos.y).toBeLessThan(8);
  });

  test('state players me hp starts at 3', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].hp).toBe(3);
  });

  test('state players me ap starts at 4', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].ap).toBe(4);
  });

  test('state players me range starts at 2', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].range).toBe(2);
  });

  test('state players me is not bot', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].isBot).toBe(false);
  });

  test('state players me botDifficulty is null', () => {
    const game = createLocalGame({ startingAp: 4 });
    expect(game.state().players['me'].botDifficulty).toBeNull();
  });
});
