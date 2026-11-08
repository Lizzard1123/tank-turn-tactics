import { describe, it, expect } from 'vitest';
import { mulberry32, hashSeed } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });
  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('values are in [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashSeed is deterministic and differs per input', () => {
    expect(hashSeed('a:1')).toBe(hashSeed('a:1'));
    expect(hashSeed('a:1')).not.toBe(hashSeed('a:2'));
  });
});
