import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuthedPlayer { id: string; name: string; isAnonymous: boolean }

// --- GoTrue JWT verification against the injected SUPABASE_JWKS ---

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Jwk { kty: string; alg?: string; kid?: string; crv?: string; x?: string; y?: string }
let jwksCache: Jwk[] | null = null;
let hmacKey: CryptoKey | null | undefined;

/**
 * Which key material verifies tokens, by environment:
 * - Hosted (new API keys): SUPABASE_JWKS is injected and GoTrue signs ES256 —
 *   the legacy JWT secret is NOT present, so HS256 tokens can never verify.
 * - Local CLI stack: GoTrue signs HS256 with the shared demo JWT secret and
 *   no JWKS exists — fall back to HMAC verification.
 */
async function hmacVerifier(): Promise<CryptoKey | null> {
  if (hmacKey !== undefined) return hmacKey;
  // LOCAL_JWT_SECRET: `functions serve` strips SUPABASE_* keys from env
  // files (it injects its own managed set), so the local secret must ride
  // under a non-reserved name. Hosted never sets it — JWKS is authoritative.
  const secret = Deno.env.get('SUPABASE_JWT_SECRET') ?? Deno.env.get('LOCAL_JWT_SECRET');
  if (!secret) {
    hmacKey = null;
    return hmacKey;
  }
  hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return hmacKey;
}

async function signingKeys(): Promise<Jwk[]> {
  if (jwksCache) return jwksCache;
  const raw = Deno.env.get('SUPABASE_JWKS');
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { keys?: Jwk[] };
  jwksCache = parsed.keys ?? [];
  return jwksCache;
}

/**
 * Verify a GoTrue access token (ES256) against the platform-injected
 * public key set. Returns the token's `sub` (the auth user id) plus
 * whether the session is anonymous (`signInAnonymously`), or null.
 * Expiry is enforced here; revocation is GoTrue's concern.
 */
export async function verifyGoTrueJwt(
  token: string,
): Promise<{ sub: string; isAnonymous: boolean } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { sub?: string; exp?: number; is_anonymous?: boolean };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  if (header.alg === 'HS256') {
    const hmac = await hmacVerifier();
    if (!hmac) return null;
    const ok = await crypto.subtle.verify(
      'HMAC',
      hmac,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    return ok && payload.sub ? { sub: payload.sub, isAnonymous: payload.is_anonymous === true } : null;
  }

  if (header.alg !== 'ES256' || !payload.sub) return null;

  const keys = await signingKeys();
  const key = (header.kid ? keys.find((k) => k.kid === header.kid) : undefined)
    ?? keys.find((k) => k.kty === 'EC' && k.alg === 'ES256');
  if (!key?.x || !key?.y) return null;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: key.crv ?? 'P-256', x: key.x, y: key.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  // JWT ES256 signatures are raw r||s — exactly WebCrypto's IEEE P1363 format
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  return ok ? { sub: payload.sub, isAnonymous: payload.is_anonymous === true } : null;
}

/**
 * Verify the token only — no players-table round trip. Callers whose very
 * next step is a load_game_detail RPC (which already returns the player
 * row) use this to keep a whole request at one database round trip.
 */
export async function getAuthUserId(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const me = await verifyGoTrueJwt(token);
  return me?.sub ?? null;
}

/**
 * Resolve the player from a GoTrue access token. Players mirror auth.users
 * one-to-one (same id, migration 0006), so `sub` IS the player id.
 */
export async function getPlayer(admin: SupabaseClient, req: Request): Promise<AuthedPlayer | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const me = await verifyGoTrueJwt(token);
  if (!me) return null;

  const { data: player } = await admin.from('players')
    .select('id, name').eq('id', me.sub).single();
  return player ? { id: me.sub, name: player.name, isAnonymous: me.isAnonymous } : null;
}
