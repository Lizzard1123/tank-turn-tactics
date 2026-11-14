import { describe, it, expect } from 'vitest';
import { manhattan, inRange, occupantAt } from '../src/geom';
import type { Vec, PlayerId } from '../src/types';

describe('manhattan', () => {
  it('computes Manhattan distance between two vectors', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 3, y: 4 };
    expect(manhattan(a, b)).toBe(7);
  });

  it('returns 0 for same position', () => {
    const a: Vec = { x: 5, y: 5 };
    expect(manhattan(a, a)).toBe(0);
  });

  it('is symmetric', () => {
    const a: Vec = { x: 1, y: 2 };
    const b: Vec = { x: 4, y: 6 };
    expect(manhattan(a, b)).toBe(manhattan(b, a));
  });

  it('handles negative coordinates', () => {
    const a: Vec = { x: -3, y: -2 };
    const b: Vec = { x: 3, y: 2 };
    expect(manhattan(a, b)).toBe(10);
  });

  it('handles one-zero coordinate', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 0, y: 5 };
    expect(manhattan(a, b)).toBe(5);
  });

  it('handles diagonal movement', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 3, y: 3 };
    expect(manhattan(a, b)).toBe(6);
  });
});

describe('inRange', () => {
  it('returns true when within range', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 2, y: 2 };
    expect(inRange(a, b, 4)).toBe(true);
  });

  it('returns true at exactly range distance', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 3, y: 0 };
    expect(inRange(a, b, 3)).toBe(true);
  });

  it('returns false beyond range', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 4, y: 0 };
    expect(inRange(a, b, 3)).toBe(false);
  });

  it('returns true for same position (range 0)', () => {
    const a: Vec = { x: 5, y: 5 };
    expect(inRange(a, a, 0)).toBe(true);
  });

  it('handles range 1 (adjacent only)', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 1, y: 0 };
    expect(inRange(a, b, 1)).toBe(true);
  });

  it('handles range 1 diagonal', () => {
    const a: Vec = { x: 0, y: 0 };
    const b: Vec = { x: 1, y: 1 };
    expect(inRange(a, b, 1)).toBe(false); // Manhattan distance = 2
  });
});

describe('occupantAt', () => {
  it('returns null when no players at position', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {
      p1: { pos: { x: 0, y: 0 }, hp: 3 },
    };
    expect(occupantAt(players, { x: 5, y: 5 })).toBeNull();
  });

  it('returns player id when alive player at position', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {
      p1: { pos: { x: 0, y: 0 }, hp: 3 },
      p2: { pos: { x: 5, y: 5 }, hp: 2 },
    };
    expect(occupantAt(players, { x: 0, y: 0 })).toBe('p1');
  });

  it('returns null for dead player (grave is passable)', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {
      p1: { pos: { x: 0, y: 0 }, hp: 0 },
    };
    expect(occupantAt(players, { x: 0, y: 0 })).toBeNull();
  });

  it('returns null for player with hp 0', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {
      p1: { pos: { x: 3, y: 3 }, hp: 0 },
    };
    expect(occupantAt(players, { x: 3, y: 3 })).toBeNull();
  });

  it('returns first alive player when multiple at same position', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {
      p1: { pos: { x: 0, y: 0 }, hp: 3 },
      p2: { pos: { x: 0, y: 0 }, hp: 2 },
    };
    const result = occupantAt(players, { x: 0, y: 0 });
    expect(['p1', 'p2']).toContain(result);
  });

  it('handles empty players object', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {};
    expect(occupantAt(players, { x: 0, y: 0 })).toBeNull();
  });

  it('handles missing hp property (defaults to alive)', () => {
    const players: Record<PlayerId, { pos: Vec; hp?: number }> = {
      p1: { pos: { x: 0, y: 0 }, hp: undefined },
    } as unknown as Record<PlayerId, { pos: Vec; hp: number }>;
    expect(occupantAt(players, { x: 0, y: 0 })).toBe('p1');
  });

  it('returns null for out-of-bounds position', () => {
    const players: Record<PlayerId, { pos: Vec; hp: number }> = {
      p1: { pos: { x: 0, y: 0 }, hp: 3 },
    };
    expect(occupantAt(players, { x: -1, y: -1 })).toBeNull();
  });
});
