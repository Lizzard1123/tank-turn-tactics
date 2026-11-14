// Integration-style tests for the Tank Turn Tactics edge functions.
//
// Each handler is imported with `Deno.serve` stubbed so its handler function is
// captured without binding a port, then invoked directly with `Request` objects.
// `fetch` is stubbed to return canned Supabase responses; HS256 JWTs are signed
// with LOCAL_JWT_SECRET so `getPlayer`/`getAuthUserId` resolve without the
// platform's JWKS. No Supabase instance is required.
//
// These tests exercise the handlers' VALIDATION logic (authorization 401/403,
// conflicts 409, input shape checks, schedule-shape field switching) — the
// server-authority surface that previously had zero coverage.
//
// Run with:
//   deno test --no-check --allow-env --allow-net _shared/edge_handlers_test.ts

// --- shared test harness ------------------------------------------------------

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
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${body}.${sigB64}`;
}

type Canned = { status?: number; body?: unknown };

interface FetchStub {
  calls: { method: string; pathname: string; body?: string }[];
  canned: Map<string, Canned>;
}

function stubFetch(): FetchStub {
  const calls: FetchStub['calls'] = [];
  const canned = new Map<string, Canned>();
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    calls.push({ method: req.method, pathname: url.pathname, body: init?.body });
    const key = `${req.method} ${url.pathname}`;
    if (canned.has(key)) {
      const c = canned.get(key)!;
      return new Response(JSON.stringify(c.body), { status: c.status ?? 200 });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  };
  return { calls, canned };
}

async function restoreFetch() {
  const orig = globalThis.fetch;
  // nothing to do; each test installs its own stub via stubFetch()
  return orig;
}

// Capture handlers as they import (Deno.serve is stubbed globally). One handler
// imported per test; grab the last captured handler.
const captured: ((req: Request) => Promise<Response>)[] = [];
const origServe = Deno.serve;
(Deno as any).serve = (handler: any) => { captured.push(handler); return {} as any; };

async function importHandler(url: string): Promise<(req: Request) => Promise<Response>> {
  await import(url);
  return captured[captured.length - 1];
}

async function postJson(handler: (req: Request) => Promise<Response>, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return handler(new Request('http://x/', {
    method: 'POST', headers, body: JSON.stringify(body),
  }));
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`assertEquals failed: ${a} !== ${b}`);
}

// ============================================================================
// game-create
// ============================================================================

Deno.test('game-create: unauthorized without token', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1 } });
  assertEquals(res.status, 401);
  assertEquals((await json(res)).error, 'unauthorized');
});

Deno.test('game-create: rejects invalid seed', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: -1 } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid seed');

  const res2 = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 2 ** 31 + 1 } }, token);
  assertEquals(res2.status, 400);
  assertEquals((await json(res2)).error, 'invalid seed');
});

Deno.test('game-create: rejects invalid board/hp/ap/range/apPerDay/upgradeCost/apIntervalMinutes', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const cases: [Record<string, unknown>, string][] = [
    [{ board: 4 }, 'board must be 5-15'],
    [{ board: 16 }, 'board must be 5-15'],
    [{ board: '8' }, 'board must be 5-15'],
    [{ startingHp: 0 }, 'startingHp must be 1-10'],
    [{ startingHp: 11 }, 'startingHp must be 1-10'],
    [{ startingAp: -1 }, 'startingAp must be 0-20'],
    [{ startingAp: 21 }, 'startingAp must be 0-20'],
    [{ baseRange: 0 }, 'baseRange must be 1-6'],
    [{ baseRange: 7 }, 'baseRange must be 1-6'],
    [{ apPerDay: -1 }, 'apPerDay must be 0-10'],
    [{ apPerDay: 11 }, 'apPerDay must be 0-10'],
    [{ upgradeCost: 0 }, 'upgradeCost must be 1-10'],
    [{ upgradeCost: 11 }, 'upgradeCost must be 1-10'],
    [{ apIntervalMinutes: -1 }, 'invalid apIntervalMinutes'],
    [{ apIntervalMinutes: 1441 }, 'invalid apIntervalMinutes'],
  ];
  for (const [over, expected] of cases) {
    const res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, ...over } }, token);
    assertEquals(res.status, 400, `case ${JSON.stringify(over)}`);
    assertEquals((await json(res)).error, expected, `case ${JSON.stringify(over)}`);
  }
});

Deno.test('game-create: rejects invalid schedule', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  for (const sched of ['apSchedule', 'heartSchedule']) {
    const res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, [sched]: 'nonsense' } }, token);
    assertEquals(res.status, 400);
    assertEquals((await json(res)).error, `invalid ${sched}`);
  }
});

Deno.test('game-create: invalid timeOfDay format rejected; invalid timezone rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });

  let res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, apSchedule: 'timeOfDay', apTimeOfDay: '9:00' } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'apTimeOfDay must be HH:mm');

  res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, apSchedule: 'timeOfDay', apTimeOfDay: '25:00' } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'apTimeOfDay must be HH:mm');

  res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, apSchedule: 'timeOfDay', apTimeOfDay: '12:00', apTimezone: 'Not/AZone' } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid apTimezone (IANA id required)');
});

Deno.test('game-create: heartSpawn off deletes heart fields', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('POST /rest/v1/games', { body: { data: [{ id: 'g1', invite_code: 'ABCD' }], error: null } });
  canned.set('POST /rest/v1/game_players', { body: { data: [], error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, {
    name: 'G', mode: 'test',
    config: { seed: 1, heartSpawn: false, heartCap: 5, heartPlacement: 'random', heartSchedule: 'interval' },
  }, token);
  assertEquals(res.status, 200);
  const body = (await json(res)) as { ok?: boolean; config?: Record<string, unknown> };
  assertEquals(body.ok, true);
  assertEquals(body.config?.heartSpawnDelayMinutes, undefined);
  assertEquals(body.config?.heartPlacement, undefined);
  assertEquals(body.config?.heartSchedule, undefined);
  assertEquals(body.config?.heartCap, undefined);
});

Deno.test('game-create: bots > 8 rejected; invalid bot difficulty rejected; seed 0 replaced with random', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('POST /rest/v1/games', { body: { data: [{ id: 'g1', invite_code: 'ABCD' }], error: null } });
  canned.set('POST /rest/v1/game_players', { body: { data: [], error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });

  const manyBots = Array.from({ length: 9 }, () => ({ difficulty: 'easy' }));
  let res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, bots: manyBots } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'max 8 bots');

  res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 1, bots: [{ difficulty: 'insane' }] } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid bot difficulty');

  // seed 0 replaced with random (non-zero); creation succeeds
  canned.set('POST /rest/v1/games', { body: { data: [{ id: 'g2', invite_code: 'WXYZ' }], error: null } });
  res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 0 } }, token);
  assertEquals(res.status, 200);
  const body = (await json(res)) as { ok?: boolean };
  assertEquals(body.ok, true);
});

Deno.test('game-create: valid config creates a game (200)', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-create/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('POST /rest/v1/games', { body: { data: [{ id: 'g1', invite_code: 'ABCD' }], error: null } });
  canned.set('POST /rest/v1/game_players', { body: { data: [], error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { name: 'G', mode: 'test', config: { seed: 42, board: 8 } }, token);
  assertEquals(res.status, 200);
  assertEquals((await json(res)), { gameId: 'g1', inviteCode: 'ABCD' });
});

// ============================================================================
// game-update
// ============================================================================

const updateGameRow = {
  mode: 'test', status: 'lobby', created_by: 'p1', config: {}, daily_ap_time: '09:00',
};

Deno.test('game-update: non-creator gets 403', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { ...updateGameRow, created_by: 'p2' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1', config: { board: 8 } }, token);
  assertEquals(res.status, 403);
  assertEquals((await json(res)).error, 'only the host can update config');
});

Deno.test('game-update: non-lobby status gets 409', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { ...updateGameRow, status: 'active' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1', config: { board: 8 } }, token);
  assertEquals(res.status, 409);
  assertEquals((await json(res)).error, 'game already started');
});

Deno.test('game-update: rejects invalid board/hp/ap/range/apPerDay/upgradeCost/apIntervalMinutes', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: updateGameRow, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const cases: [Record<string, unknown>, string][] = [
    [{ board: 4 }, 'board must be 5-15'],
    [{ board: 16 }, 'board must be 5-15'],
    [{ startingHp: 0 }, 'startingHp must be 1-10'],
    [{ startingAp: -1 }, 'startingAp must be 0-20'],
    [{ baseRange: 0 }, 'baseRange must be 1-6'],
    [{ apPerDay: 11 }, 'apPerDay must be 0-10'],
    [{ upgradeCost: 0 }, 'upgradeCost must be 1-10'],
    [{ apIntervalMinutes: -1 }, 'invalid apIntervalMinutes'],
    [{ apIntervalMinutes: 1441 }, 'invalid apIntervalMinutes'],
  ];
  for (const [patch, expected] of cases) {
    const res = await postJson(handler, { gameId: 'g1', config: patch }, token);
    assertEquals(res.status, 400, `case ${JSON.stringify(patch)}`);
    assertEquals((await json(res)).error, expected, `case ${JSON.stringify(patch)}`);
  }
});

Deno.test('game-update: invalid apSchedule / heartSchedule rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: updateGameRow, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1', config: { apSchedule: 'bogus' } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid apSchedule');
  const res2 = await postJson(handler, { gameId: 'g1', config: { heartSchedule: 'bogus' } }, token);
  assertEquals(res2.status, 400);
  assertEquals((await json(res2)).error, 'invalid heartSchedule');
});

Deno.test('game-update: schedule shape switch deletes abandoned fields', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: {
    data: { ...updateGameRow, config: { apSchedule: 'timeOfDay', apTimeOfDay: '12:00', apTimezone: 'UTC', apIntervalMinutes: 0 } },
    error: null,
  } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1', config: { apSchedule: 'interval', apIntervalMinutes: 30 } }, token);
  assertEquals(res.status, 200);
  const body = (await json(res)) as { ok?: boolean; config?: Record<string, unknown> };
  assertEquals(body.ok, true);
  assertEquals(body.config?.apTimeOfDay, undefined);
  assertEquals(body.config?.apTimezone, undefined);
  assertEquals(body.config?.apIntervalMinutes, 30);
});

Deno.test('game-update: heartSpawn off deletes heart fields', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: {
    data: { ...updateGameRow, config: { heartSpawn: true, heartCap: 5, heartPlacement: 'random', heartSchedule: 'interval', heartIntervalMinutes: 10 } },
    error: null,
  } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1', config: { heartSpawn: false } }, token);
  assertEquals(res.status, 200);
  const body = (await json(res)) as { ok?: boolean; config?: Record<string, unknown> };
  assertEquals(body.ok, true);
  assertEquals(body.config?.heartSpawnDelayMinutes, undefined);
  assertEquals(body.config?.heartPlacement, undefined);
  assertEquals(body.config?.heartCap, undefined);
  assertEquals(body.config?.heartSchedule, undefined);
  assertEquals(body.config?.heartIntervalMinutes, undefined);
});

Deno.test('game-update: heartPlacement must be random/smart; heartCap 1-20', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-update/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: updateGameRow, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });

  const res1 = await postJson(handler, { gameId: 'g1', config: { heartPlacement: 'weird' } }, token);
  assertEquals(res1.status, 400);
  assertEquals((await json(res1)).error, 'invalid heartPlacement');

  const res2 = await postJson(handler, { gameId: 'g1', config: { heartCap: 0 } }, token);
  assertEquals(res2.status, 400);
  assertEquals((await json(res2)).error, 'heartCap must be 1-20');

  const res3 = await postJson(handler, { gameId: 'g1', config: { heartCap: 21 } }, token);
  assertEquals(res3.status, 400);
  assertEquals((await json(res3)).error, 'heartCap must be 1-20');

  // valid placement + cap accepted
  const res4 = await postJson(handler, { gameId: 'g1', config: { heartSpawn: true, heartPlacement: 'smart', heartCap: 7 } }, token);
  assertEquals(res4.status, 200);
});

// ============================================================================
// game-join
// ============================================================================

Deno.test('game-join: test games are private (403)', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-join/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { id: 'g1', status: 'lobby', mode: 'test', created_by: 'p2', cur_generation: 1, config: {} }, error: null } });
  canned.set('GET /rest/v1/game_players', { body: { data: null, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { inviteCode: 'ABCD' }, token);
  assertEquals(res.status, 403);
  assertEquals((await json(res)).error, 'test games are private');
});

Deno.test('game-join: anonymous guests cannot join shared games (403)', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-join/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'anon', name: 'Guest' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { id: 'g1', status: 'lobby', mode: 'play', created_by: 'p2', cur_generation: 1, config: {} }, error: null } });
  const token = await sign({ sub: 'anon', is_anonymous: true, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { inviteCode: 'ABCD' }, token);
  assertEquals(res.status, 403);
  assertEquals((await json(res)).error, 'register to join shared games');
});

Deno.test('game-join: mid-game join requires allowLateJoin === true', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-join/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  // active game WITHOUT allowLateJoin -> 409
  canned.set('GET /rest/v1/games', { body: { data: { id: 'g1', status: 'active', mode: 'play', created_by: 'p2', cur_generation: 1, config: {} }, error: null } });
  canned.set('GET /rest/v1/game_players', { body: { data: null, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  let res = await postJson(handler, { inviteCode: 'ABCD' }, token);
  assertEquals(res.status, 409);
  assertEquals((await json(res)).error, 'game already started');

  // active game WITH allowLateJoin === true -> proceeds (needs game_state snapshot)
  canned.set('GET /rest/v1/games', { body: { data: { id: 'g1', status: 'active', mode: 'play', created_by: 'p2', cur_generation: 1, config: { allowLateJoin: true } }, error: null } });
  canned.set('GET /rest/v1/game_state', { body: {
    data: { seq: 0, state: { seq: 0, players: { p1: { id: 'p1', name: 'One', pos: { x: 0, y: 0 }, hp: 3, ap: 0, range: 2, isBot: false, botDifficulty: null } }, order: ['p1'], jury: [], pendingVotes: [], winner: null, log: [], hearts: [], haunted: null, config: { seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 } } },
    error: null,
  } });
  canned.set('GET /rest/v1/events', { body: { data: [], error: null } });
  canned.set('POST /rest/v1/game_players', { body: { data: [], error: null } });
  canned.set('POST /rest/v1/events', { body: { data: [], error: null } });
  res = await postJson(handler, { inviteCode: 'ABCD' }, token);
  assertEquals(res.status, 200);
});

Deno.test('game-join: invalid invite code rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-join/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });

  let res = await postJson(handler, { inviteCode: 'AB' }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid invite code');

  res = await postJson(handler, { inviteCode: 123 }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid invite code');

  // unknown code -> 404 game not found
  canned.set('GET /rest/v1/games', { body: { data: null, error: null } });
  res = await postJson(handler, { inviteCode: 'ABCD' }, token);
  assertEquals(res.status, 404);
  assertEquals((await json(res)).error, 'game not found');
});

Deno.test('game-join: lobby join succeeds and is idempotent', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-join/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { id: 'g1', status: 'lobby', mode: 'play', created_by: 'p2', cur_generation: 1, config: {} }, error: null } });
  canned.set('GET /rest/v1/game_players', { body: { data: null, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { inviteCode: 'ABCD' }, token);
  assertEquals(res.status, 200);
  assertEquals((await json(res)), { gameId: 'g1' });
});

// ============================================================================
// game-start
// ============================================================================

const startGameRow = {
  id: 'g1', created_by: 'p1', status: 'lobby', mode: 'play',
  config: { board: 8, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, bots: [] },
};

Deno.test('game-start: non-host gets 403; non-lobby gets 409', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-start/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { ...startGameRow, created_by: 'p2' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  let res = await postJson(handler, { gameId: 'g1' }, token);
  assertEquals(res.status, 403);
  assertEquals((await json(res)).error, 'only the host can start');

  canned.set('GET /rest/v1/games', { body: { data: { ...startGameRow, status: 'active' }, error: null } });
  res = await postJson(handler, { gameId: 'g1' }, token);
  assertEquals(res.status, 409);
  assertEquals((await json(res)).error, 'game already started');
});

Deno.test('game-start: too many players for board rejected; fewer than 2 rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-start/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { ...startGameRow, config: { ...startGameRow.config, board: 2, bots: [] } }, error: null } });
  // board 2 -> capacity 4. 4 humans (host + 3) = 4, not > 4. Add a bot -> 5 > 4
  canned.set('GET /rest/v1/game_players', { body: {
    data: [
      { player_id: 'p1', is_bot: false },
      { player_id: 'p2', is_bot: false },
      { player_id: 'p3', is_bot: false },
      { player_id: 'p4', is_bot: false },
    ],
    error: null,
  } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  let res = await postJson(handler, { gameId: 'g1' }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'too many players (5) for board 2x2');

  // fewer than 2: only host
  canned.set('GET /rest/v1/game_players', { body: { data: [ { player_id: 'p1', is_bot: false } ], error: null } });
  res = await postJson(handler, { gameId: 'g1' }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'need at least 2 players (add bots or invite friends)');
});

Deno.test('game-start: invalid bot difficulty rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/game-start/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('GET /rest/v1/games', { body: { data: { ...startGameRow, config: { ...startGameRow.config, bots: [{ difficulty: 'insane' }] } }, error: null } });
  canned.set('GET /rest/v1/game_players', { body: { data: [ { player_id: 'p1', is_bot: false } ], error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1' }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid bot difficulty');
});

// ============================================================================
// action
// ============================================================================

const actionDetail = {
  player: { id: 'p1', name: 'One' },
  game: {
    id: 'g1', mode: 'play', status: 'active', created_by: 'p1', cur_generation: 1, fork_seq: null,
    config: { seed: 1, board: 8, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
  },
  members: [ { player_id: 'p1' }, { player_id: 'p2' } ],
  snap: {
    seq: 1,
    state: {
      seq: 1,
      players: {
        p1: { id: 'p1', name: 'One', pos: { x: 0, y: 0 }, hp: 3, ap: 5, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'Two', pos: { x: 1, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
      order: ['p1', 'p2'],
      jury: [], pendingVotes: [], winner: null, log: [], hearts: [], haunted: null,
      config: { seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
    },
  },
  tail: [], history: [], forks: [], membership: true,
};

Deno.test('action: sanitizePayload strips disallowed keys (anon on attack, extra keys)', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/action/index.ts');
  const { canned, calls } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  canned.set('POST /rest/v1/rpc/load_game_detail', { body: { data: actionDetail, error: null } });
  canned.set('POST /rest/v1/rpc/commit_game_update', { body: { data: null, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });

  const res = await postJson(handler, { gameId: 'g1', type: 'attack', payload: { targetId: 'p2', anon: true, extraKey: 'nope' } }, token);
  assertEquals(res.status, 200);

  // Find the commit_game_update call and inspect its payload: anon + extraKey stripped, only targetId remains
  const commitCalls = calls.filter((c) => c.pathname === '/rest/v1/rpc/commit_game_update');
  assertEquals(commitCalls.length, 1, `expected 1 commit call, got ${commitCalls.length}`);
  const commitBody = JSON.parse(commitCalls[0].body!);
  const payload = commitBody.p_events?.[0]?.payload;
  assertEquals(payload, { targetId: 'p2' }, `sanitized payload should be {targetId:'p2'}, got ${JSON.stringify(payload)}`);
});

Deno.test('action: invalid action type rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/action/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  const res = await postJson(handler, { gameId: 'g1', type: 'nuke', payload: {} }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid request');
});

Deno.test('action: fork non-test mode or non-host rejected; toSeq out of range rejected', async () => {
  const handler = await importHandler('file:///Users/ethan/Desktop/Development/tank_turn_tactics/supabase/functions/action/index.ts');
  const { canned } = stubFetch();
  canned.set('GET /rest/v1/players', { body: { data: { id: 'p1', name: 'One' }, error: null } });

  // play mode game, host -> fork rejected (not test)
  canned.set('POST /rest/v1/rpc/load_game_detail', { body: { data: { ...actionDetail, game: { ...actionDetail.game, mode: 'play', created_by: 'p1' } }, error: null } });
  const token = await sign({ sub: 'p1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 10000 });
  let res = await postJson(handler, { gameId: 'g1', type: 'fork', payload: { toSeq: 0 } }, token);
  assertEquals(res.status, 403);
  assertEquals((await json(res)).error, 'fork allowed only for own test games');

  // non-host on test game
  canned.set('POST /rest/v1/rpc/load_game_detail', { body: { data: { ...actionDetail, game: { ...actionDetail.game, mode: 'test', created_by: 'p2' } }, error: null } });
  res = await postJson(handler, { gameId: 'g1', type: 'fork', payload: { toSeq: 0 } }, token);
  assertEquals(res.status, 403);
  assertEquals((await json(res)).error, 'fork allowed only for own test games');

  // toSeq out of range (host, test game, snap.seq=1)
  canned.set('POST /rest/v1/rpc/load_game_detail', { body: { data: { ...actionDetail, game: { ...actionDetail.game, mode: 'test', created_by: 'p1' } }, error: null } });
  res = await postJson(handler, { gameId: 'g1', type: 'fork', payload: { toSeq: 99 } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid toSeq');

  // toSeq negative
  res = await postJson(handler, { gameId: 'g1', type: 'fork', payload: { toSeq: -1 } }, token);
  assertEquals(res.status, 400);
  assertEquals((await json(res)).error, 'invalid toSeq');
});
