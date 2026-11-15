// Payload validation shared by the action edge function and its tests.
// Kept free of Deno.serve so it can be unit-tested without starting a server.

// Payload whitelist per action type. Everything else — including any `anon`
// flag (the engine's masked-attack replay marker, which would let a client
// attack without paying AP) — is stripped before the payload reaches the
// engine or the events table.
export const ALLOWED_KEYS: Record<string, string[]> = {
  move: ['to'],
  attack: ['targetId'],
  give_ap: ['targetId'],
  give_heart: ['targetId'],
  upgrade_range: [],
  jury_vote: ['candidateId'],
  fork: ['toSeq'],
};

export function sanitizePayload(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS[type] ?? []) {
    if (key in payload) out[key] = payload[key];
  }
  return out;
}
