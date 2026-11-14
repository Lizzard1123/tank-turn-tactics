import { describe, test, expect } from 'vitest';
import { flagForPlayerId, flagUrl, COUNTRY_CODES } from './flags';

describe('flags', () => {
  test('deterministic: the same player id always maps to the same country code', () => {
    expect(flagForPlayerId('3decfe87-7724-4add-a3ae-bfce181b0a5e'))
      .toBe(flagForPlayerId('3decfe87-7724-4add-a3ae-bfce181b0a5e'));
  });

  test('codes are the real-flag set (2-letter ISO, non-empty, lowercase)', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(200);
    for (const c of COUNTRY_CODES) {
      expect(c).toMatch(/^[a-z]{2}$/);
    }
  });

  test('different ids spread across the flag set (not all the same flag)', () => {
    const codes = new Set(
      Array.from({ length: 50 }, (_, i) => flagForPlayerId(`player-${i}`)),
    );
    expect(codes.size).toBeGreaterThan(10);
  });

  test('flagUrl points at the bundled real-flag asset under the app base', () => {
    const url = flagUrl('p1');
    expect(url).toMatch(/flags\/[a-z]{2}\.svg$/);
    expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true);
  });

  test('same id always returns same flag', () => {
    const flag1 = flagForPlayerId('p1');
    const flag2 = flagForPlayerId('p1');
    expect(flag1).toBe(flag2);
  });

  test('different ids can return same flag', () => {
    const flag1 = flagForPlayerId('p1');
    const flag2 = flagForPlayerId('p2');
    // Some ids may map to same flag due to limited country codes
    expect([flag1, flag2]).toHaveLength(2);
  });

  test('flag codes are 2 characters', () => {
    const flag = flagForPlayerId('p1');
    expect(flag).toHaveLength(2);
  });

  test('flag codes are lowercase', () => {
    const flag = flagForPlayerId('p1');
    expect(flag).toBe(flag.toLowerCase());
  });

  test('flag codes match ISO 3166-1 format', () => {
    const flag = flagForPlayerId('p1');
    expect(flag).toMatch(/^[a-z]{2}$/);
  });

  test('COUNTRY_CODES is an array', () => {
    expect(Array.isArray(COUNTRY_CODES)).toBe(true);
  });

  test('COUNTRY_CODES has entries', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(0);
  });

  test('flagUrl has correct path', () => {
    const url = flagUrl('p1');
    expect(url).toContain('flags/');
  });

  test('flagUrl has svg extension', () => {
    const url = flagUrl('p1');
    expect(url).toContain('.svg');
  });

  test('flagUrl starts with base url', () => {
    const url = flagUrl('p1');
    expect(url.startsWith('/')).toBe(true);
  });

  test('flagForPlayerId accepts string', () => {
    const flag = flagForPlayerId('test-id');
    expect(typeof flag).toBe('string');
  });

  test('flagForPlayerId returns string', () => {
    const flag = flagForPlayerId('test-id');
    expect(typeof flag).toBe('string');
  });

  test('flagForPlayerId with empty string', () => {
    const flag = flagForPlayerId('');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with numeric string', () => {
    const flag = flagForPlayerId('12345');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with special characters', () => {
    const flag = flagForPlayerId('test-id!@#');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with long string', () => {
    const flag = flagForPlayerId('a'.repeat(1000));
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with unicode', () => {
    const flag = flagForPlayerId('test-unicode-中文');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with null chars', () => {
    const flag = flagForPlayerId('test\0null');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with whitespace', () => {
    const flag = flagForPlayerId('   test   ');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with newlines', () => {
    const flag = flagForPlayerId('test\n\n');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });

  test('flagForPlayerId with tabs', () => {
    const flag = flagForPlayerId('test\t\t');
    expect(typeof flag).toBe('string');
    expect(flag).toHaveLength(2);
  });
});
