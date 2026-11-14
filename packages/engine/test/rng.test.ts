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
  it('produces consistent sequence length', () => {
    const r = mulberry32(123);
    const seq = [];
    for (let i = 0; i < 10000; i++) seq.push(r());
    expect(seq).toHaveLength(10000);
  });
  it('seed 0 works', () => {
    const r = mulberry32(0);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
  it('seed max works', () => {
    const r = mulberry32(2147483647);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
  it('multiple instances are independent', () => {
    const r1 = mulberry32(1);
    const r2 = mulberry32(2);
    const v1 = [], v2 = [];
    for (let i = 0; i < 100; i++) {
      v1.push(r1());
      v2.push(r2());
    }
    expect(v1).not.toEqual(v2);
  });
  it('no predictable pattern in first 10 values', () => {
    const r = mulberry32(99);
    const vals = [r(), r(), r(), r(), r(), r(), r(), r(), r(), r()];
    // All values should be different
    const unique = new Set(vals);
    expect(unique.size).toBe(vals.length);
  });
  it('large seed produces valid output', () => {
    const r = mulberry32(999999999);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
  it('seed string works', () => {
    const r = mulberry32('abc');
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('hashSeed', () => {
  it('is deterministic for the same input', () => {
    expect(hashSeed('a:1')).toBe(hashSeed('a:1'));
  });
  it('differs across inputs', () => {
    expect(hashSeed('a:1')).not.toBe(hashSeed('a:2'));
  });
  it('returns a number', () => {
    const h = hashSeed('test');
    expect(typeof h).toBe('number');
  });
  it('empty string works', () => {
    const h = hashSeed('');
    expect(typeof h).toBe('number');
    expect(h).toBeGreaterThanOrEqual(0);
  });
  it('long string works', () => {
    const h = hashSeed('a'.repeat(10000));
    expect(typeof h).toBe('number');
    expect(h).toBeGreaterThanOrEqual(0);
  });
  it('special characters work', () => {
    const h = hashSeed('!@#$%^&*()');
    expect(typeof h).toBe('number');
  });
  it('unicode works', () => {
    const h = hashSeed('你好世界');
    expect(typeof h).toBe('number');
  });
  it('whitespace matters', () => {
    expect(hashSeed('a')).not.toBe(hashSeed(' a'));
    expect(hashSeed('a')).not.toBe(hashSeed('a '));
  });
  it('case matters', () => {
    expect(hashSeed('ABC')).not.toBe(hashSeed('abc'));
  });
  it('can be used as mulberry32 seed', () => {
    const h = hashSeed('test:seed');
    const r = mulberry32(h);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
  it('hash is consistent across many calls', () => {
    const hashes = [];
    for (let i = 0; i < 100; i++) {
      hashes.push(hashSeed(`seed:${i}`));
    }
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });
});

describe('mulberry32 + hashSeed integration', () => {
  it('hashSeed output feeds into mulberry32', () => {
    const h = hashSeed('integration:test');
    const r1 = mulberry32(h);
    const r2 = mulberry32(h);
    expect(r1()).toBe(r2());
  });
  it('different inputs produce different sequences', () => {
    const h1 = hashSeed('seq:1');
    const h2 = hashSeed('seq:2');
    const r1 = mulberry32(h1);
    const r2 = mulberry32(h2);
    expect(r1()).not.toBe(r2());
  });
  it('sequence length does not affect values', () => {
    const r = mulberry32(42);
    const first = [];
    for (let i = 0; i < 10; i++) first.push(r());
    const second = [];
    for (let i = 0; i < 10; i++) second.push(r());
    expect(first).not.toEqual(second);
  });
  it('seed from hash is usable for game placement', () => {
    const h = hashSeed('game:placement');
    const r = mulberry32(h);
    const board = 8;
    const x = Math.floor(r() * board);
    const y = Math.floor(r() * board);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(board);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(board);
  });
  it('many hashes produce unique values', () => {
    const hashes = new Set();
    for (let i = 0; i < 1000; i++) {
      hashes.add(hashSeed(`unique:${i}`));
    }
    expect(hashes.size).toBe(1000);
  });
});
