import { describe, it, expect } from 'vitest';
import { createInitialState, normalizeHeartState } from '../src/state';
import { inRange, manhattan } from '../src/geom';
import type { GameConfig, GameState, PlayerState } from '../src/types';

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
  it('seq starts at 0', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.seq).toBe(0);
  });
  it('day starts at 1', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.day).toBe(1);
  });
  it('tickClockMinutes starts at 0', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.tickClockMinutes).toBe(0);
  });
  it('winner is null', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.winner).toBeNull();
  });
  it('haunted is null', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.haunted).toBeNull();
  });
  it('hearts is empty array', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.hearts).toEqual([]);
  });
  it('jury is empty array', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.jury).toEqual([]);
  });
  it('pendingVotes is empty array', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.pendingVotes).toEqual([]);
  });
  it('log is empty array', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(s.log).toEqual([]);
  });
  it('order matches player ids', () => {
    const s = createInitialState(cfg(), specs(3));
    expect(s.order).toEqual(['p1', 'p2', 'p3']);
  });
  it('supports single player', () => {
    const s = createInitialState(cfg(), specs(1));
    expect(Object.keys(s.players)).toHaveLength(1);
  });
  it('supports max players for board', () => {
    const s = createInitialState(cfg({ board: 3 }), specs(9));
    expect(Object.keys(s.players)).toHaveLength(9);
  });
  it('throws when players exactly exceed board capacity', () => {
    expect(() => createInitialState(cfg({ board: 2 }), specs(5))).toThrow(/too many/);
  });
  it('preserves custom config values', () => {
    const s = createInitialState(cfg({ startingHp: 5, startingAp: 10, baseRange: 4 }), specs(1));
    expect(s.players.p1.hp).toBe(5);
    expect(s.players.p1.ap).toBe(10);
    expect(s.players.p1.range).toBe(4);
  });
  it('places bots correctly', () => {
    const botSpecs = [{ id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'hard' as const }];
    const s = createInitialState(cfg(), botSpecs);
    expect(s.players.b1.isBot).toBe(true);
    expect(s.players.b1.botDifficulty).toBe('hard');
  });
  it('generates unique positions', () => {
    const s = createInitialState(cfg({ board: 5 }), specs(5));
    const positions = Object.values(s.players).map(p => `${p.pos.x},${p.pos.y}`);
    const unique = new Set(positions);
    expect(unique.size).toBe(5);
  });
  it('handles large board', () => {
    const s = createInitialState(cfg({ board: 20 }), specs(10));
    for (const p of Object.values(s.players)) {
      expect(p.pos.x).toBeLessThan(20);
      expect(p.pos.y).toBeLessThan(20);
    }
  });
  it('config is stored correctly', () => {
    const customCfg: GameConfig = {
      seed: 99, board: 10, startingHp: 5, startingAp: 3, baseRange: 3,
      apPerDay: 2, upgradeCost: 4, apIntervalMinutes: 30,
    };
    const s = createInitialState(customCfg, specs(1));
    expect(s.config).toEqual(customCfg);
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
  it('manhattan symmetry', () => {
    const a = { x: 3, y: 7 };
    const b = { x: 10, y: 2 };
    expect(manhattan(a, b)).toBe(manhattan(b, a));
  });
  it('manhattan zero for same point', () => {
    expect(manhattan({x: 5, y: 5}, {x: 5, y: 5})).toBe(0);
  });
  it('inRange exact boundary', () => {
    expect(inRange({x:0,y:0}, {x:3,y:0}, 3)).toBe(true);
    expect(inRange({x:0,y:0}, {x:4,y:0}, 3)).toBe(false);
  });
  it('inRange diagonal', () => {
    expect(inRange({x:0,y:0}, {x:1,y:1}, 2)).toBe(true); // Manhattan = 2
    expect(inRange({x:0,y:0}, {x:2,y:1}, 2)).toBe(false); // Manhattan = 3
  });
});

describe('normalizeHeartState', () => {
  it('lifts legacy heart to hearts array', () => {
    const legacy = {
      seq: 0, day: 1, tickClockMinutes: 0, config: cfg(),
      players: {}, order: [], jury: [], pendingVotes: [], winner: null, log: [],
      hearts: undefined as unknown as [],
      heart: { x: 3, y: 4, seq: 7 },
      haunted: null,
    } as unknown as GameState;
    const result = normalizeHeartState(legacy);
    expect(result.hearts).toEqual([{ x: 3, y: 4, seq: 7 }]);
    expect(result.heart).toBeNull();
  });
  it('returns same state when hearts already populated', () => {
    const normalized: GameState = {
      seq: 0, day: 1, tickClockMinutes: 0, config: cfg(),
      players: {}, order: [], jury: [], pendingVotes: [], winner: null, log: [],
      hearts: [{ x: 1, y: 1, seq: 1 }],
      heart: null, haunted: null,
    } as GameState;
    const result = normalizeHeartState(normalized);
    expect(result).toBe(normalized);
  });
  it('handles null heart', () => {
    const nullHeart: GameState = {
      seq: 0, day: 1, tickClockMinutes: 0, config: cfg(),
      players: {}, order: [], jury: [], pendingVotes: [], winner: null, log: [],
      hearts: undefined as unknown as [],
      heart: null, haunted: null,
    } as GameState;
    const result = normalizeHeartState(nullHeart);
    expect(result.hearts).toEqual([]);
    expect(result.heart).toBeNull();
  });
  it('preserves all other state fields', () => {
    const legacy: GameState = {
      seq: 5, day: 3, tickClockMinutes: 10, config: cfg(),
      players: { p1: { id: 'p1', name: 'A', pos: { x: 0, y: 0 }, hp: 3, ap: 2, range: 2, isBot: false, botDifficulty: null } },
      order: ['p1'], jury: [], pendingVotes: [], winner: null, log: [],
      hearts: undefined as unknown as [],
      heart: { x: 2, y: 3, seq: 5 }, haunted: null,
    } as GameState;
    const result = normalizeHeartState(legacy);
    expect(result.seq).toBe(5);
    expect(result.day).toBe(3);
    expect(result.tickClockMinutes).toBe(10);
    expect(result.players.p1).toEqual(legacy.players.p1);
    expect(result.order).toEqual(['p1']);
  });
});
