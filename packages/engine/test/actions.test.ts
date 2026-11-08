import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import { createInitialState } from '../src/state';
import type { GameConfig, GameEvent, GameState } from '../src/types';

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
// test-only teleport helper
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
});

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
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, pos: s.players.p2.pos } } }; // can't occupy same cell; use in-range teleport
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
});

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
});

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
});

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
});
