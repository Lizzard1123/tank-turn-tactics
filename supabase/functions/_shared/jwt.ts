// HS256 sign/verify for session tokens using the project JWT secret.
// The Supabase gateway verifies the JWT before our function runs; we then
// resolve the player from the `sub` claim via the sessions table.
// Uses WebCrypto (async) — available in the Edge runtime.

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function secret(): string {
  return Deno.env.get('SUPABASE_JWT_SECRET') ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSessionJwt(playerId: string, ttlDays = 30): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    sub: playerId,
    role: 'authenticated',
    iat: now,
    exp: now + ttlDays * 86400,
  }));
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

export async function verifySessionJwt(token: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    fromB64url(sig),
    new TextEncoder().encode(data),
  );
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
