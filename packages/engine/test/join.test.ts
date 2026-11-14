import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/state';
import { applyEvent } from '../src/reducer';
import { occupantAt } from '../src/geom';
import type { GameConfig, GameEvent, GameState } from '../src/types';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, ...over,
});
const specs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, isBot: false, botDifficulty: null,
  }));

const joinEvent = (state: GameState, id: string, name: string): GameEvent => ({
  seq: state.seq + 1,
  type: 'join',
  actorId: id,
  createdAt: new Date().toISOString(),
  payload: { playerId: id, name },
});

describe('join event (mid-game late join)', () => {
  it('spawns the player on the first free cell with starting stats', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    const p = s1.players['p9'];
    expect(p).toBeDefined();
    expect(p.hp).toBe(3);
    expect(p.ap).toBe(0);
    expect(p.range).toBe(2);
    expect(p.isBot).toBe(false);
    expect(occupantAt(s1.players, p.pos)).toBe('p9');
    expect(p.pos.x).toBeLessThan(8);
    expect(p.pos.y).toBeLessThan(8);
    expect(occupantAt(s0.players, p.pos)).toBeNull();
  });
  it('appends to order and logs a join entry', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.order).toContain('p9');
    expect(s1.order.length).toBe(3);
    const last = s1.log[s1.log.length - 1];
    expect(last.text).toContain('Newbie');
    expect(last.text).toContain('joined');
    expect(s1.seq).toBe(s0.seq + 1);
  });
  it('spawns deterministically (same replay -> same cell)', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const a = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    const b = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(a.players['p9'].pos).toEqual(b.players['p9'].pos);
  });
  it('throws when the board is full', () => {
    const s0 = createInitialState(cfg({ board: 1 }), specs(1));
    expect(() => applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'))).toThrow(/full/i);
  });
  it('is idempotent: re-joining an existing player is a no-op', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const seqBefore = s0.seq;
    const s1 = applyEvent(s0, joinEvent(s0, 'p1', 'Impostor'));
    expect(s1.players['p1']?.name).toBe('P1');
    expect(s1.seq).toBe(seqBefore + 1);
  });
  it('does not mutate the previous state', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const before = JSON.stringify(s0);
    applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(JSON.stringify(s0)).toBe(before);
  });

  // Additional join tests
  it('new player has null winner', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.players.p9.winner).toBeFalsy();
  });
  it('new player has null haunted', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.players.p9.haunted).toBeFalsy();
  });
  it('new player is not in jury', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.jury).not.toContain('p9');
  });
  it('new player position is inside board', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.players.p9.pos.x).toBeGreaterThanOrEqual(0);
    expect(s1.players.p9.pos.x).toBeLessThan(8);
    expect(s1.players.p9.pos.y).toBeGreaterThanOrEqual(0);
    expect(s1.players.p9.pos.y).toBeLessThan(8);
  });
  it('join preserves existing players', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.players.p1).toBeDefined();
    expect(s1.players.p2).toBeDefined();
  });
  it('join on empty board', () => {
    const s0 = createInitialState(cfg(), []);
    const s1 = applyEvent(s0, joinEvent(s0, 'p1', 'Solo'));
    expect(s1.players.p1).toBeDefined();
    expect(s1.players.p1.hp).toBe(3);
  });
  it('join with custom config', () => {
    const s0 = createInitialState(cfg({ startingHp: 5 }), specs(1));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.players.p9.hp).toBe(5); // uses config startingHp
  });
  it('multiple joins in sequence', () => {
    const s0 = createInitialState(cfg(), []);
    const s1 = applyEvent(s0, joinEvent(s0, 'p1', 'First'));
    const s2 = applyEvent(s1, joinEvent(s1, 'p2', 'Second'));
    expect(s2.players.p1).toBeDefined();
    expect(s2.players.p2).toBeDefined();
    expect(s2.order.length).toBe(2);
  });
  it('join log entry is last in log', () => {
    const s0 = createInitialState(cfg(), specs(1));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.log[s1.log.length - 1].text).toContain('joined');
  });
  it('join seq increments', () => {
    const s0 = createInitialState(cfg(), specs(1));
    const seqBefore = s0.seq;
    applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s0.seq + 1).toBe(seqBefore + 1);
  });
  it('join on large board', () => {
    const s0 = createInitialState(cfg({ board: 20 }), specs(10));
    const s1 = applyEvent(s0, joinEvent(s0, 'p99', 'BigBoard'));
    expect(s1.players.p99.pos.x).toBeLessThan(20);
    expect(s1.players.p99.pos.y).toBeLessThan(20);
  });
  it('join position is unoccupied', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(occupantAt(s1.players, s1.players.p9.pos)).toBe('p9');
    expect(occupantAt(s0.players, s1.players.p9.pos)).toBeNull();
  });
  it('join with minimal name', () => {
    const s0 = createInitialState(cfg(), specs(1));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'x'));
    expect(s1.players.p9.name).toBe('x');
  });
  it('join with long name', () => {
    const s0 = createInitialState(cfg(), specs(1));
    const longName = 'a'.repeat(100);
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', longName));
    expect(s1.players.p9.name).toBe(longName);
  });
});
