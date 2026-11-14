import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import { createInitialState } from '../src/state';
import type { GameConfig, GameEvent, GameState, PlayerState } from '../src/types';

const cfg: GameConfig = {
  seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const base = createInitialState(cfg, [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
]);

function ev(state: GameState, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: state.seq + 1, type, actorId, createdAt: new Date().toISOString(), payload };
}
function placeNear(s: GameState, a: string, b: string): GameState {
  const posB = s.players[b].pos;
  const nx = posB.x + 1 <= 7 ? posB.x + 1 : posB.x - 1;
  return { ...s, players: { ...s.players,
    [a]: { ...s.players[a], pos: { x: nx, y: posB.y } } } };
}
function placeFar(s: GameState, a: string, b: string): GameState {
  return { ...s, players: { ...s.players,
    [a]: { ...s.players[a], pos: { x: 0, y: 0 } },
    [b]: { ...s.players[b], pos: { x: 7, y: 7 } } } };
}

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe('move', () => {
  it('moves 1 orthogonal square and costs 1 AP', () => {
    let s = base;
    const from = s.players.p1.pos;
    const to = { x: (from.x + 1) % 8, y: from.y };
    s = applyEvent(s, ev(s, 'p1', 'move', { to }));
    expect(s.players.p1.pos).toEqual(to);
    expect(s.players.p1.ap).toBe(3);
  });
  it('rejects diagonal, out-of-board, occupied, multi-square, and no-AP moves', () => {
    const from = base.players.p1.pos;
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: { x: from.x + 1, y: from.y + 1 } }))).toThrow(EngineError);
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: { x: from.x + 3, y: from.y } }))).toThrow(EngineError);
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: { x: -1, y: from.y } }))).toThrow(EngineError);
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: base.players.p2.pos }))).toThrow(EngineError);
    const noAp = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 0 } } };
    expect(() => applyEvent(noAp, ev(noAp, 'p1', 'move', { to: { x: from.x + 1, y: from.y } }))).toThrow(EngineError);
  });
  it('move left', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 3, y: 3 } } } };
    const to = { x: 2, y: 3 };
    const s2 = applyEvent(s, ev(s, 'p1', 'move', { to }));
    expect(s2.players.p1.pos).toEqual(to);
  });
  it('move up', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 3, y: 3 } } } };
    const to = { x: 3, y: 2 };
    const s2 = applyEvent(s, ev(s, 'p1', 'move', { to }));
    expect(s2.players.p1.pos).toEqual(to);
  });
  it('move down', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 3, y: 3 } } } };
    const to = { x: 3, y: 4 };
    const s2 = applyEvent(s, ev(s, 'p1', 'move', { to }));
    expect(s2.players.p1.pos).toEqual(to);
  });
  it('move right', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 3, y: 3 } } } };
    const to = { x: 4, y: 3 };
    const s2 = applyEvent(s, ev(s, 'p1', 'move', { to }));
    expect(s2.players.p1.pos).toEqual(to);
  });
  it('cannot move off board edge left', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 0, y: 0 } } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'move', { to: { x: -1, y: 0 } }))).toThrow(EngineError);
  });
  it('cannot move off board edge top', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 0, y: 0 } } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'move', { to: { x: 0, y: -1 } }))).toThrow(EngineError);
  });
  it('cannot move off board edge right', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 7, y: 7 } } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'move', { to: { x: 8, y: 7 } }))).toThrow(EngineError);
  });
  it('cannot move off board edge bottom', () => {
    const s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: { x: 7, y: 7 } } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'move', { to: { x: 7, y: 8 } }))).toThrow(EngineError);
  });
  it('preserves player hp after move', () => {
    const s0 = { ...base, players: { ...base.players, p1: { ...base.players.p1, hp: 2 } } };
    const from = s0.players.p1.pos;
    const to = { x: from.x + 1 < 8 ? from.x + 1 : from.x - 1, y: from.y };
    const s1 = applyEvent(s0, ev(s0, 'p1', 'move', { to }));
    expect(s1.players.p1.hp).toBe(2);
  });
  it('preserves player range after move', () => {
    const s0 = { ...base, players: { ...base.players, p1: { ...base.players.p1, range: 3 } } };
    const from = s0.players.p1.pos;
    const to = { x: from.x + 1 < 8 ? from.x + 1 : from.x - 1, y: from.y };
    const s1 = applyEvent(s0, ev(s0, 'p1', 'move', { to }));
    expect(s1.players.p1.range).toBe(3);
  });
  it('works with multiple sequential moves', () => {
    let s = base;
    const from = s.players.p1.pos;
    const to1 = { x: (from.x + 1) % 8, y: from.y };
    s = applyEvent(s, ev(s, 'p1', 'move', { to: to1 }));
    const to2 = { x: (to1.x + 1) % 8, y: to1.y };
    s = applyEvent(s, ev(s, 'p1', 'move', { to: to2 }));
    expect(s.players.p1.pos).toEqual(to2);
  });
});

// ---------------------------------------------------------------------------
// attack
// ---------------------------------------------------------------------------

describe('attack', () => {
  it('in-range attack costs 1 AP and removes 1 HP; kill moves to jury and wins', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(2);
    expect(s.jury).toEqual([]);
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 1 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.jury).toContain('p2');
    expect(s.winner).toBe('p1');
  });
  it('kill with 3 players does NOT set winner', () => {
    const three = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
    ]);
    let s = { ...three, players: { ...three.players, p2: { ...three.players.p2, hp: 1 } } };
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, pos: { x: (s.players.p2.pos.x + 1) % 8, y: s.players.p2.pos.y } } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.jury).toContain('p2');
    expect(s.winner).toBeNull();
  });
  it('rejects out-of-range and self-attack', () => {
    const far = placeFar(base, 'p1', 'p2');
    expect(() => applyEvent(far, ev(far, 'p1', 'attack', { targetId: 'p2' }))).toThrow(EngineError);
    expect(() => applyEvent(placeNear(base, 'p1', 'p2'), ev(base, 'p1', 'attack', { targetId: 'p1' }))).toThrow(EngineError);
  });
  it('attack on alive target reduces hp but does not kill', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 3 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(2);
    expect(s.jury).toEqual([]);
  });
  it('attack on hp 1 target kills', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 1 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(0);
    expect(s.jury).toContain('p2');
  });
  it('attack on dead target fails', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 0 } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }))).toThrow(EngineError);
  });
  it('preserves attacker position after attack', () => {
    let s = placeNear(base, 'p1', 'p2');
    const p1Pos = { ...s.players.p1.pos };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p1.pos).toEqual(p1Pos);
  });
  it('preserves attacker range after attack', () => {
    let s = placeNear(base, 'p1', 'p2');
    const p1Range = s.players.p1.range;
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p1.range).toBe(p1Range);
  });
  it('attack log entry is appended', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.log.length).toBeGreaterThan(0);
    expect(s.log[s.log.length - 1].text).toContain('attack');
  });
  it('attack with range 0 on adjacent target', () => {
    const s0 = { ...cfg, baseRange: 0 };
    const s = createInitialState(s0, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    const adj = { ...s, players: { ...s.players, p2: { ...s.players.p2, pos: { x: 1, y: 0 } } } };
    expect(() => applyEvent(adj, ev(adj, 'p1', 'attack', { targetId: 'p2' }))).toThrow(EngineError);
  });
  it('attack with range 1 on diagonal target', () => {
    const s0 = { ...cfg, baseRange: 1 };
    const s = createInitialState(s0, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    const diag = { ...s, players: { ...s.players, p2: { ...s.players.p2, pos: { x: 1, y: 1 } } } };
    // Manhattan distance = 2, range = 1, so should fail
    expect(() => applyEvent(diag, ev(diag, 'p1', 'attack', { targetId: 'p2' }))).toThrow(EngineError);
  });
});

// ---------------------------------------------------------------------------
// give_ap and upgrade_range
// ---------------------------------------------------------------------------

describe('give_ap and upgrade_range', () => {
  it('gives 1 AP per 1 AP in range', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = applyEvent(s, ev(s, 'p1', 'give_ap', { targetId: 'p2' }));
    expect(s.players.p1.ap).toBe(3);
    expect(s.players.p2.ap).toBe(5);
  });
  it('upgrades range for upgradeCost AP', () => {
    let s = applyEvent(base, ev(base, 'p1', 'upgrade_range', {}));
    expect(s.players.p1.range).toBe(3);
    expect(s.players.p1.ap).toBe(2);
  });
  it('rejects out-of-range give and insufficient AP upgrade', () => {
    const far = placeFar(base, 'p1', 'p2');
    expect(() => applyEvent(far, ev(far, 'p1', 'give_ap', { targetId: 'p2' }))).toThrow(EngineError);
    const poor = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 1 } } };
    expect(() => applyEvent(poor, ev(poor, 'p1', 'upgrade_range', {}))).toThrow(EngineError);
  });
  it('rejects give_ap to dead player', () => {
    const dead = { ...base, players: { ...base.players, p2: { ...base.players.p2, hp: 0 } } };
    expect(() => applyEvent(dead, ev(dead, 'p1', 'give_ap', { targetId: 'p2' }))).toThrow(EngineError);
  });
  it('give_ap to self in range', () => {
    let s = placeNear(base, 'p1', 'p2');
    const p2ApBefore = s.players.p2.ap;
    s = applyEvent(s, ev(s, 'p1', 'give_ap', { targetId: 'p2' }));
    expect(s.players.p2.ap).toBe(p2ApBefore + 1); // gives 1 AP
  });
  it('upgrade_range multiple times', () => {
    let s = base;
    s = applyEvent(s, ev(s, 'p1', 'upgrade_range', {}));
    expect(s.players.p1.range).toBe(3);
    s = applyEvent(s, ev(s, 'p1', 'upgrade_range', {}));
    expect(s.players.p1.range).toBe(4);
  });
  it('give_ap preserves target hp', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 2 } } };
    s = applyEvent(s, ev(s, 'p1', 'give_ap', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(2);
  });
  it('give_ap with insufficient AP', () => {
    const poor = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 0 } } };
    let s = placeNear(poor, 'p1', 'p2');
    expect(() => applyEvent(s, ev(s, 'p1', 'give_ap', { targetId: 'p2' }))).toThrow(EngineError);
  });
  it('upgrade_range on range 0', () => {
    const zeroCfg: GameConfig = { seed: 1, board: 8, startingHp: 3, startingAp: 2, baseRange: 0, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 };
    let s = createInitialState(zeroCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    s = applyEvent(s, ev(s, 'p1', 'upgrade_range', {}));
    expect(s.players.p1.range).toBe(1);
  });
  it('give_ap to target with max AP', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, ap: 100 } } };
    s = applyEvent(s, ev(s, 'p1', 'give_ap', { targetId: 'p2' }));
    expect(s.players.p2.ap).toBe(101);
  });
});

// ---------------------------------------------------------------------------
// bot_action
// ---------------------------------------------------------------------------

describe('bot_action', () => {
  it('applies the inner action as the bot', () => {
    const s = { ...base, players: { ...base.players, p2: { ...base.players.p2, isBot: true, botDifficulty: 'easy' as const } } };
    const from = s.players.p2.pos;
    const s2 = applyEvent(s, ev(s, 'p2', 'bot_action', { inner: { type: 'move', payload: { to: { x: (from.x + 1) % 8, y: from.y } } } }));
    expect(s2.players.p2.ap).toBe(3);
  });
  it('rejects bot_action from a non-bot actor', () => {
    const from = base.players.p1.pos;
    expect(() => applyEvent(base, ev(base, 'p1', 'bot_action', { inner: { type: 'move', payload: { to: { x: (from.x + 1) % 8, y: from.y } } } }))).toThrow(EngineError);
  });
  it('rejects bot_action with invalid inner action', () => {
    const s = { ...base, players: { ...base.players, p2: { ...base.players.p2, isBot: true, botDifficulty: 'easy' as const } } };
    expect(() => applyEvent(s, ev(s, 'p2', 'bot_action', { inner: { type: 'invalid', payload: {} } }))).toThrow(EngineError);
  });
  it('bot move works', () => {
    const s = { ...base, players: { ...base.players, p2: { ...base.players.p2, isBot: true, botDifficulty: 'easy' as const } } };
    const from = s.players.p2.pos;
    const s2 = applyEvent(s, ev(s, 'p2', 'bot_action', { inner: { type: 'move', payload: { to: { x: (from.x + 1) % 8, y: from.y } } } }));
    expect(s2.players.p2.hp).toBe(3); // startingHp
  });
  it('bot attack works', () => {
    const botSpec = { id: 'p2', name: 'B', isBot: true, botDifficulty: 'easy' as const };
    const s = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      botSpec,
    ]);
    // Place p2 adjacent to p1
    const p1Pos = s.players.p1.pos;
    const p2Adj = { x: p1Pos.x + 1 < 8 ? p1Pos.x + 1 : 0, y: p1Pos.y };
    const s2 = { ...s, players: { ...s.players,
      p2: { ...s.players.p2, pos: p2Adj, hp: 3, ap: 4 },
      p1: { ...s.players.p1, hp: 3 } } };
    const s3 = applyEvent(s2, ev(s2, 'p2', 'bot_action', { inner: { type: 'attack', payload: { targetId: 'p1' } } }));
    expect(s3.players.p1.hp).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// log + seq
// ---------------------------------------------------------------------------

describe('log + seq', () => {
  it('appends a human-readable log entry per event with matching seq', () => {
    const s = applyEvent(base, ev(base, 'p1', 'upgrade_range', {}));
    expect(s.log.at(-1)!.seq).toBe(base.seq + 1);
    expect(s.log.at(-1)!.text).toMatch(/p1|A/);
  });
  it('rejects seq gaps', () => {
    const bad: GameEvent = { seq: base.seq + 2, type: 'upgrade_range', actorId: 'p1', createdAt: '', payload: {} };
    expect(() => applyEvent(base, bad)).toThrow(EngineError);
  });
  it('rejects unknown actor', () => {
    expect(() => applyEvent(base, ev(base, 'ghost', 'upgrade_range', {}))).toThrow(EngineError);
  });
  it('log entry has text', () => {
    const s = applyEvent(base, ev(base, 'p1', 'upgrade_range', {}));
    expect(s.log[s.log.length - 1].text).toBeDefined();
  });
  it('log entry has seq', () => {
    const s = applyEvent(base, ev(base, 'p1', 'upgrade_range', {}));
    expect(s.log[s.log.length - 1].seq).toBe(base.seq + 1);
  });
  it('seq increments correctly', () => {
    const from1 = base.players.p1.pos;
    const to1 = { x: from1.x + 1 < 8 ? from1.x + 1 : from1.x - 1, y: from1.y };
    const s1 = applyEvent(base, ev(base, 'p1', 'move', { to: to1 }));
    const from2 = s1.players.p2.pos;
    const to2 = { x: from2.x + 1 < 8 ? from2.x + 1 : from2.x - 1, y: from2.y };
    const s2 = applyEvent(s1, ev(s1, 'p2', 'move', { to: to2 }));
    expect(s2.seq).toBe(2);
  });
  it('multiple log entries preserved', () => {
    const from1 = base.players.p1.pos;
    const to1 = { x: from1.x + 1 < 8 ? from1.x + 1 : from1.x - 1, y: from1.y };
    const s1 = applyEvent(base, ev(base, 'p1', 'move', { to: to1 }));
    const from2 = s1.players.p2.pos;
    const to2 = { x: from2.x + 1 < 8 ? from2.x + 1 : from2.x - 1, y: from2.y };
    const s2 = applyEvent(s1, ev(s1, 'p2', 'move', { to: to2 }));
    expect(s2.log.length).toBe(2);
  });
});
