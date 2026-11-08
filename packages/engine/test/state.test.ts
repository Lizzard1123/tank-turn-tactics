import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/state';
import { inRange, manhattan } from '../src/geom';
import type { GameConfig } from '../src/types';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, ...over,
});
const specs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, isBot: false, botDifficulty: null,
  }));

describe('createInitialState', () => {
  it('gives every player starting stats', () => {
    const s = createInitialState(cfg(), specs(3));
    expect(Object.values(s.players).every(p =>
      p.hp === 3 && p.ap === 0 && p.range === 2)).toBe(true);
  });
  it('places players on distinct cells inside the board', () => {
    const s = createInitialState(cfg({ board: 6 }), specs(5));
    const cells = new Set(Object.values(s.players).map(p => `${p.pos.x},${p.pos.y}`));
    expect(cells.size).toBe(5);
    for (const p of Object.values(s.players)) {
      expect(p.pos.x).toBeLessThan(6); expect(p.pos.y).toBeLessThan(6);
    }
  });
  it('is deterministic on the same seed', () => {
    const a = createInitialState(cfg(), specs(4));
    const b = createInitialState(cfg(), specs(4));
    expect(a.order).toEqual(b.order);
    expect(a.players).toEqual(b.players);
  });
  it('throws if players exceed cells', () => {
    expect(() => createInitialState(cfg({ board: 2 }), specs(5))).toThrow();
  });
});

describe('geom', () => {
  it('manhattan distance', () => {
    expect(manhattan({x:0,y:0}, {x:2,y:1})).toBe(3);
  });
  it('inRange uses manhattan <= range', () => {
    expect(inRange({x:0,y:0}, {x:2,y:0}, 2)).toBe(true);
    expect(inRange({x:0,y:0}, {x:2,y:1}, 2)).toBe(false);
  });
});
