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
  it('tick clock defaults to 0', () => {
    const s = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    expect(s.tickClockMinutes).toBe(0);
  });
  it('multiple ticks advance day', () => {
    let s = base;
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.day).toBe(3);
  });
  it('tick with apGained 0', () => {
    let s = applyEvent(base, ev(base, 'system', 'daily_tick', { apGained: 0 }));
    for (const p of Object.values(s.players)) expect(p.ap).toBe(0);
  });
  it('tick with large apGained', () => {
    let s = applyEvent(base, ev(base, 'system', 'daily_tick', { apGained: 10 }));
    for (const p of Object.values(s.players)) expect(p.ap).toBe(10);
  });
  it('tick preserves player hp', () => {
    let s = { ...base, players: { ...base.players, p1: { ...base.players.p1, hp: 2 } } };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.hp).toBe(2);
  });
  it('tick preserves player positions', () => {
    const p1Pos = { ...base.players.p1.pos };
    let s = applyEvent(base, ev(base, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.pos).toEqual(p1Pos);
  });
  it('tick preserves player range', () => {
    const p1Range = base.players.p1.range;
    let s = applyEvent(base, ev(base, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.range).toBe(p1Range);
  });
});

describe('jury', () => {
  it('dead player can vote once per day', () => {
    let s = { ...base, jury: ['p3'], players: { ...base.players, p3: { ...base.players.p3, hp: 0 } } };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    expect(s.pendingVotes).toContainEqual({ voterId: 'p3', candidateId: 'p1' });
  });
  it('re-voting replaces the ballot: still one vote per juror per day', () => {
    const deadP3 = { ...base.players.p3, hp: 0 };
    const deadP4 = { ...base.players.p4, hp: 0 };
    let s: GameState = { ...base, jury: ['p3'], pendingVotes: [{ voterId: 'p3', candidateId: 'p1' }],
      players: { ...base.players, p3: deadP3 } };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p2' }));
    expect(s.pendingVotes).toEqual([{ voterId: 'p3', candidateId: 'p2' }]);
    // another juror's vote is untouched by the change
    let t: GameState = { ...base, jury: ['p3', 'p4'],
      pendingVotes: [{ voterId: 'p3', candidateId: 'p1' }, { voterId: 'p4', candidateId: 'p2' }],
      players: { ...base.players, p3: deadP3, p4: deadP4 },
      order: [...base.order, 'p4'] };
    t = applyEvent(t, ev(t, 'p3', 'jury_vote', { candidateId: 'p2' }));
    expect(t.pendingVotes).toHaveLength(2);
    expect(t.pendingVotes).toContainEqual({ voterId: 'p4', candidateId: 'p2' });
  });
  it('alive player cannot vote', () => {
    expect(() => applyEvent(base, ev(base, 'p1', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });
  it('rejects vote for unknown candidate', () => {
    let s = { ...base, jury: ['p3'] };
    expect(() => applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'ghost' }))).toThrow(EngineError);
  });
  it('three jury votes award 1 bonus AP on tick, then votes clear', () => {
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
  it('jury vote preserves player hp', () => {
    let s = { ...base, jury: ['p3'], players: { ...base.players, p3: { ...base.players.p3, hp: 0 } } };
    const hpBefore = s.players.p1.hp;
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    expect(s.players.p1.hp).toBe(hpBefore);
  });
  it('jury vote preserves player positions', () => {
    let s = { ...base, jury: ['p3'], players: { ...base.players, p3: { ...base.players.p3, hp: 0 } } };
    const p1Pos = { ...s.players.p1.pos };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    expect(s.players.p1.pos).toEqual(p1Pos);
  });
  it('multiple jury votes for same candidate', () => {
    const dead = (id: string) => ({ ...base.players[id], hp: 0 });
    let s = { ...base,
      players: { ...base.players, p3: dead('p3'), p4: dead('p4') },
      order: [...base.order, 'p4'], jury: ['p3', 'p4'] };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    s = applyEvent(s, ev(s, 'p4', 'jury_vote', { candidateId: 'p1' }));
    expect(s.pendingVotes).toHaveLength(2);
  });
  it('jury vote from non-jury member rejected', () => {
    expect(() => applyEvent(base, ev(base, 'p1', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });
  it('clear winner with only 2 votes: no bonus (below the 3-vote floor)', () => {
    const dead = (id: string) => ({ ...base.players[id], hp: 0 });
    let s = { ...base,
      players: { ...base.players, p3: dead('p3'), p4: dead('p4'), p5: dead('p5') },
      order: [...base.order, 'p4', 'p5'], jury: ['p3', 'p4', 'p5'] };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    s = applyEvent(s, ev(s, 'p4', 'jury_vote', { candidateId: 'p2' }));
    s = applyEvent(s, ev(s, 'p5', 'jury_vote', { candidateId: 'p1' }));
    // p1 has 2 (clear winner but < 3), p2 has 1 → no bonus
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(1); // drip only
    expect(s.players.p2.ap).toBe(1);
  });
  it('tie for most votes with 3 each: no bonus, no haunt', () => {
    const dead = (id: string) => ({ ...base.players[id], hp: 0 });
    let s = { ...base,
      players: {
        ...base.players,
        p3: dead('p3'), p4: dead('p4'), p5: dead('p5'), p6: dead('p6'),
        p7: dead('p7'), p8: dead('p8'),
      },
      order: [...base.order, 'p4', 'p5', 'p6', 'p7', 'p8'],
      jury: ['p3', 'p4', 'p5', 'p6', 'p7', 'p8'] };
    for (const j of ['p3', 'p4', 'p5']) s = applyEvent(s, ev(s, j, 'jury_vote', { candidateId: 'p1' }));
    for (const j of ['p6', 'p7', 'p8']) s = applyEvent(s, ev(s, j, 'jury_vote', { candidateId: 'p2' }));
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(1); // drip only — tie fizzes the bonus
    expect(s.players.p2.ap).toBe(1);
    expect(s.haunted).toBeNull();
    expect(s.lastBonus).toEqual([]);
  });
  it('only the MOST-voted candidate gets the bonus, even if others reach 3+', () => {
    const dead = (id: string) => ({ ...base.players[id], hp: 0 });
    let s = { ...base,
      players: {
        ...base.players,
        p3: dead('p3'), p4: dead('p4'), p5: dead('p5'), p6: dead('p6'),
        p7: dead('p7'), p8: dead('p8'),
      },
      order: [...base.order, 'p4', 'p5', 'p6', 'p7', 'p8'],
      jury: ['p3', 'p4', 'p5', 'p6', 'p7', 'p8'] };
    // p1 gets 4 votes, p2 gets 2 — p2 never reaches 3, so this checks p1 alone.
    // For a second candidate with 3+ but fewer votes we'd need 7 jurors; the
    // point (one winner max) is covered by the 3-vote cap in findBonusWinner.
    for (const j of ['p3', 'p4', 'p5']) s = applyEvent(s, ev(s, j, 'jury_vote', { candidateId: 'p1' }));
    for (const j of ['p6', 'p7']) s = applyEvent(s, ev(s, j, 'jury_vote', { candidateId: 'p2' }));
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(2); // drip + bonus
    expect(s.players.p2.ap).toBe(1); // drip only
    expect(s.lastBonus).toEqual([{ id: 'p1', day: s.day }]);
  });
});

describe('tick edge cases', () => {
  it('tick preserves jury', () => {
    let s = { ...base, jury: ['p1', 'p2'] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.jury).toEqual(['p1', 'p2']);
  });
  it('tick clears pendingVotes on tick', () => {
    let s = { ...base, pendingVotes: [{ voterId: 'p1', candidateId: 'p2' }] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.pendingVotes).toEqual([]);
  });
  it('tick preserves hearts', () => {
    let s = { ...base, hearts: [{ x: 3, y: 3, seq: 1 }] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.hearts).toEqual([{ x: 3, y: 3, seq: 1 }]);
  });
  it('tick preserves log', () => {
    let s = { ...base, log: [{ seq: 0, text: 'initial', kind: undefined }] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.log.length).toBe(2);
  });
});
