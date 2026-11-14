// Debug game-update: print resolved me and game
const SECRET = 'edge-test-secret';
Deno.env.set('LOCAL_JWT_SECRET', SECRET);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');

function b64url(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sign(payload: Record<string, unknown>): Promise<string> {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${body}.${sigB64}`;
}

const calls: { method: string; pathname: string }[] = [];
const canned = new Map<string, { status?: number; body?: unknown }>();
canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
canned.set('GET /rest/v1/games', { body: { data: { mode: 'test', status: 'active', created_by: 'p1', config: {}, daily_ap_time: '09:00' }, error: null } });
(globalThis as any).fetch = async (input: any, init?: any) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  calls.push({ method: req.method, pathname: url.pathname });
  const key = `${req.method} ${url.pathname}`;
  console.log('FETCH', key);
  if (canned.has(key)) {
    const c = canned.get(key)!;
    return new Response(JSON.stringify(c.body), { status: c.status ?? 200 });
  }
  return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
};

const captured: any[] = [];
(Deno as any).serve = (h: any) => { captured.push(h); return {} as any; };

Deno.test('debug game-update non-lobby', async () => {
  await import('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const handler = captured[captured.length - 1];
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  console.log('TOKEN', token.slice(0, 30));
  const res = await handler(new Request('http://x/', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ gameId: 'g1', config: { board: 8 } }),
  }));
  console.log('STATUS', res.status);
  console.log('BODY', await res.text());
  console.log('CALLS', JSON.stringify(calls));
});
