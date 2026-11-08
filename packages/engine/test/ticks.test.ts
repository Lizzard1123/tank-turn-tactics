import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import { createInitialState } from '../src/state';
import type { GameConfig, GameEvent, GameState } from '../src/types';

const cfg: GameConfig = {
  seed: 5, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const base = createInitialState(cfg, [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
  { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
]);

function ev(state: GameState, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: state.seq + 1, type, actorId, createdAt: '2026-01-01T00:00:00Z', payload };
}

describe('daily_tick', () => {
  it('gives apGained to all alive players and advances the day', () => {
    let s = applyEvent(base, ev(base, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.day).toBe(2);
    for (const p of Object.values(s.players)) expect(p.ap).toBe(1);
  });
  it('dead players get nothing', () => {
    let s = { ...base, players: { ...base.players, p3: { ...base.players.p3, hp: 0 } } };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p3.ap).toBe(0);
    expect(s.players.p1.ap).toBe(1);
  });
  it('tick clock advances for test mode', () => {
    let s = applyEvent(base, ev(base, 'system', 'daily_tick', { apGained: 1, elapsedMinutes: 5 }));
    expect(s.tickClockMinutes).toBe(5);
  });
});

describe('jury', () => {
  it('dead player can vote once per day', () => {
    let s = { ...base, jury: ['p3'], players: { ...base.players, p3: { ...base.players.p3, hp: 0 } } };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    expect(s.pendingVotes).toContainEqual({ voterId: 'p3', candidateId: 'p1' });
  });
  it('rejects duplicate vote in the same day', () => {
    let s = { ...base, jury: ['p3'], pendingVotes: [{ voterId: 'p3', candidateId: 'p1' }] };
    expect(() => applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });
  it('alive player cannot vote', () => {
    expect(() => applyEvent(base, ev(base, 'p1', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });
  it('rejects vote for unknown candidate', () => {
    let s = { ...base, jury: ['p3'] };
    expect(() => applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'ghost' }))).toThrow(EngineError);
  });
  it('three jury votes award 1 bonus AP on tick, then votes clear', () => {
    // three dead players remain in `players` with hp 0
    const dead = (id: string) => ({ ...base.players[id], hp: 0 });
    let s = { ...base,
      players: { ...base.players, p3: dead('p3'), p4: dead('p4'), p5: dead('p5') },
      order: [...base.order, 'p4', 'p5'], jury: ['p3', 'p4', 'p5'] };
    for (const j of ['p3', 'p4', 'p5']) s = applyEvent(s, ev(s, j, 'jury_vote', { candidateId: 'p1' }));
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(2); // 1 drip + 1 jury bonus
    expect(s.players.p2.ap).toBe(1);
    expect(s.pendingVotes).toEqual([]);
  });
  it('two votes award nothing', () => {
    const dead = (id: string) => ({ ...base.players[id], hp: 0 });
    let s = { ...base,
      players: { ...base.players, p3: dead('p3'), p4: dead('p4') },
      order: [...base.order, 'p4'], jury: ['p3', 'p4'] };
    for (const j of ['p3', 'p4']) s = applyEvent(s, ev(s, j, 'jury_vote', { candidateId: 'p1' }));
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(1);
  });
});
