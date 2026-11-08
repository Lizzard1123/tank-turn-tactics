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
});
