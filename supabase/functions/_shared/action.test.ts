import { assertEquals, assert } from 'jsr:@std/assert@1';
import { sanitizePayload, ALLOWED_KEYS } from './action-validation.ts';

Deno.test('sanitizePayload: keeps only whitelisted keys per action type', () => {
  assertEquals(sanitizePayload('move', { to: { x: 1, y: 0 }, extra: 'junk' }), { to: { x: 1, y: 0 } });
  assertEquals(sanitizePayload('attack', { targetId: 'p2', anon: true }), { targetId: 'p2' });
  assertEquals(sanitizePayload('give_ap', { targetId: 'p2', amount: 99 }), { targetId: 'p2' });
  assertEquals(sanitizePayload('give_heart', { targetId: 'p2' }), { targetId: 'p2' });
  assertEquals(sanitizePayload('upgrade_range', { bogus: 1 }), {});
  assertEquals(sanitizePayload('jury_vote', { candidateId: 'p1' }), { candidateId: 'p1' });
  assertEquals(sanitizePayload('fork', { toSeq: 3, actor_id: 'spoof' }), { toSeq: 3 });
});

Deno.test('sanitizePayload: strips the dangerous anon flag from attacks', () => {
  const out = sanitizePayload('attack', { targetId: 'p2', anon: true });
  assertEquals(out.anon, undefined);
  assert(!('anon' in out));
});

Deno.test('sanitizePayload: unknown action type returns empty object', () => {
  assertEquals(sanitizePayload('bogus', { to: { x: 1, y: 0 } }), {});
});

Deno.test('sanitizePayload: missing payload returns empty object', () => {
  assertEquals(sanitizePayload('move', {}), {});
});

Deno.test('ALLOWED_KEYS covers every action type', () => {
  for (const t of ['move', 'attack', 'give_ap', 'give_heart', 'upgrade_range', 'jury_vote', 'fork']) {
    assert(t in ALLOWED_KEYS, `missing whitelist for ${t}`);
    assert(Array.isArray(ALLOWED_KEYS[t]));
  }
});
