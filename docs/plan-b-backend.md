# Plan B — Supabase Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase backend: schema + RLS, name/password auth via Edge
Functions, action endpoints backed by `@ttt/engine`, cron AP drip, bot fill.

**Architecture:** Postgres tables per spec. Clients hold session tokens and
use the anon key + RLS. All game writes go through Edge Functions running
under the service role, which validate with the engine, append events, and
refresh `game_state`. `pg_cron` → pg_net calls `tick` hourly.

**Tech Stack:** Supabase CLI (local dev stack), Deno Edge Functions
(imports `@ttt/engine`), `bcryptjs` in functions, pg_cron/pg_net.

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`
**Overview:** `docs/plans-overview.md`

## Global Constraints

- Client-facing endpoints verify the session token and act **as that player**;
  service role is used only for: writing events, bot fill, cron tick.
- The `events` table denies client INSERT/UPDATE/DELETE via RLS
  (`no anon/authenticated writes` policy).
- Every game mutation appends exactly one event (or several in one cron pass)
  and updates `game_state` to `(new seq, replayed state)`.
- **Fork semantics:** `fork {toSeq}` bumps `games.cur_generation`, stores
  `fork_seq = toSeq`. New events append at `(generation = cur_generation,
  seq = 1..)`. Authoritative replay = events of `generation ≤ cur_generation`,
  truncated at the newest applicable `fork_seq`. Old generations are never
  deleted — full history stays inspectable in the scrubber.
- Tests run against `supabase start` local stack + Deno unit tests.
- Migration files are plain SQL, committed under `supabase/migrations/`.

---

### Task B1: Local Supabase scaffold + schema migration

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/0001_schema.sql`

**Interfaces:**
- Produces: tables below. Later tasks and the app rely on these exact names.

- [ ] **Step 1: Init** — `supabase init` (commit `config.toml`).
- [ ] **Step 2: Write 0001_schema.sql**

```sql
create extension if not exists pgcrypto;

create table players (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check (char_length(name) between 2 and 24),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  player_id uuid not null references players(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null check (mode in ('play','test')),
  config jsonb not null,
  status text not null default 'lobby' check (status in ('lobby','active','finished')),
  created_by uuid not null references players(id),
  daily_ap_time time not null default '09:00',      -- play mode
  ap_interval_minutes int,                           -- test mode
  last_tick_at timestamptz,
  cur_generation int not null default 1,             -- bumped on fork
  fork_seq int,                                      -- replay truncation point
  invite_code text unique not null default substr(md5(random()::text), 1, 10),
  created_at timestamptz not null default now()
);

create table game_players (
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  is_bot boolean not null default false,
  bot_difficulty text check (bot_difficulty in ('easy','medium','hard')),
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table events (
  game_id uuid not null references games(id) on delete cascade,
  generation int not null default 1,   -- forked history gets generation+1
  seq int not null,
  type text not null,
  actor_id text not null,          -- uuid string, bot id, or 'system'
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (game_id, generation, seq)
);

create table game_state (
  game_id uuid primary key references games(id) on delete cascade,
  seq int not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index events_game_seq_idx on events (game_id, seq);
create index games_status_idx on games (status);
```

- [ ] **Step 3: Apply locally** — `supabase start && supabase db reset`.
- [ ] **Step 4: Verify tables** via `supabase db dump --local | grep 'create table'`.
- [ ] **Step 5: Commit** `feat(backend): schema migration`.

---

### Task B2: RLS policies

**Files:**
- Create: `supabase/migrations/0002_rls.sql`

**Interfaces:**
- Produces: RLS rules the app's anon-key queries rely on. Key behaviors:
  - `players`: readable only for **own row** (id matches the session's
    player, via a `requesting_player_id()` helper that reads the
    `x-session-token` header-mapped claim — see Step 2 note).
  - `games`: SELECT for members OR lobby status (lobby = joinable listing);
    INSERT/UPDATE only by creator through service role (Edge Functions).
  - `events` / `game_state` / `sessions`: SELECT for members (events,
    game_state) / owner (sessions); **no INSERT/UPDATE/DELETE for clients**.

**Implementation note (token→player mapping):** Postgres can't hash-verify
bcrypt tokens. Edge Functions set a claim per request using
`set_config('request.jwt.claims', ...)`, so RLS reads player identity from a
GUC set by `dbMigrations`/functions. For local simplicity v1: clients use the
**anon key** for reads; membership-filtered reads go through Edge Functions
(`list-games`, `get-game`) rather than direct table selects — RLS on
`events`/`game_state` then only needs to allow service role. This avoids
custom claim plumbing entirely and is the recommended path.

- [ ] **Step 1: Write 0002_rls.sql**

```sql
alter table players   enable row level security;
alter table sessions  enable row level security;
alter table games     enable row level security;
alter table game_players enable row level security;
alter table events    enable row level security;
alter table game_state enable row level security;

-- No policies for anon/authenticated on players/sessions/games/...:
-- default deny. Clients never query these tables directly; they call
-- Edge Functions (service role bypasses RLS).

-- Explicit deny-in-spirit for events writes (service role bypasses anyway):
create policy no_client_event_writes on events
  for insert to anon, authenticated with check (false);
```

- [ ] **Step 2: Verify** — as anon key, `select * from players` returns
  empty (RLS deny), and INSERT into events fails.
- [ ] **Step 3: Commit** `feat(backend): rls policies`.

---

### Task B3: register / signin Edge Functions

**Files:**
- Create: `supabase/functions/register/index.ts`
- Create: `supabase/functions/signin/index.ts`
- Create: `supabase/functions/_shared/cors.ts`

**Interfaces:**
- Produces (HTTP JSON):
  - `POST /register {name, password}` → `{token, player:{id,name}}` or
    `{error}`. Name unique, 2–24 chars; password ≥ 8 chars.
  - `POST /signin {name, password}` → `{token, player}` or `{error}`.
  - Tokens: 32-byte url-safe random, expiry 30 days, stored in `sessions`.

- [ ] **Step 1: Implement shared cors helper**

```ts
// _shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Implement register**

```ts
// register/index.ts (Deno)
import bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { json } from '../_shared/cors.ts';

const admin = (await import('https://esm.sh/@supabase/supabase-js@2')).createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const { name, password } = await req.json();
  if (typeof name !== 'string' || name.length < 2 || name.length > 24)
    return json({ error: 'name must be 2-24 chars' }, 400);
  if (typeof password !== 'string' || password.length < 8)
    return json({ error: 'password must be 8+ chars' }, 400);
  const hash = await bcrypt.hash(password);
  const { data, error } = await admin.from('players')
    .insert({ name, password_hash: hash }).select('id, name').single();
  if (error) return json({ error: 'name taken' }, 409);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await admin.from('sessions').insert({
    token, player_id: data.id, expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
  });
  return json({ token, player: data });
});
```

- [ ] **Step 3: Implement signin** — same shape: fetch by name, `bcrypt.compare`,
  on success create session row + return token; on failure
  `json({error:'invalid name or password'}, 401)`.
- [ ] **Step 4: Local test via curl**

```bash
supabase functions serve register --env-file ./supabase/.env.local
curl -s localhost:54321/functions/v1/register -H 'content-type: application/json' \
  -d '{"name":"ethan","password":"hunter2hunter2"}'
# → {"token":"...","player":{"id":"...","name":"ethan"}}
```

- [ ] **Step 5: Commit** `feat(backend): register + signin functions`.

---

### Task B4: Auth helper + action Edge Function (move/attack/give/upgrade/fork)

**Files:**
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/engine.ts`
- Create: `supabase/functions/action/index.ts`
- Test: `supabase/functions/action/action.test.ts` (Deno test)

**Interfaces:**
- Consumes: `@ttt/engine` (A8): `replay`, `applyEvent`, `createInitialState`.
- Produces:
  - `getPlayer(req): {id, name} | null` — reads `Authorization: Bearer <token>`,
    looks up non-expired session.
  - `POST /action {gameId, type, payload}` → `{ok: true, seq, state}` — runs
    full validation pipeline (below) or `{error}` with 4xx.
  - Accepts `type` ∈ `move|attack|give_ap|upgrade_range|jury_vote|fork`.
  - `fork` restricted to test-mode games (creator only) with `{toSeq}`.

**Validation pipeline (the authority):**

1. Auth: resolve player from token; 401 if none.
2. Load game + membership; 403 if not member (creator counts as member).
3. Load events for game (current generation, ordered, truncated at
   `fork_seq` if set); `replay()` into current state.
4. Map HTTP action → engine event (`actorId = player.id`, `seq = state.seq+1`,
   `createdAt = now`); call `applyEvent`; catch `EngineError` → 400 with
   message.
5. Insert event row; upsert `game_state` (`seq`, `state`); return new state.

- [ ] **Step 1: auth.ts**

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function getPlayer(admin: SupabaseClient, req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data } = await admin.from('sessions')
    .select('expires_at, player_id, players(id, name)')
    .eq('token', token).single();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return { id: data.player_id as string, name: (data.players as any).name as string };
}
```

- [ ] **Step 2: engine shim for Deno** — copy or vendor the engine sources:
  create `supabase/functions/_shared/engine.ts` that re-exports from a
  vendored copy (`supabase/functions/_shared/engine_src/*.ts` — a build step
  copies `packages/engine/src/*` there before deploy; document in
  `supabase/functions/README.md`).

- [ ] **Step 3: action/index.ts** — implement the 5-step pipeline above.

- [ ] **Step 4: Deno test** — start local stack; test register→create game
  (via dashboard function in B5)→move; assert 400 on invalid move (not enough
  AP) and 200 + state on valid move.
- [ ] **Step 5: Commit** `feat(backend): action endpoint with engine authority`.

---

### Task B5: game lifecycle functions (create / join / start / list / get)

**Files:**
- Create: `supabase/functions/game-create/index.ts`
- Create: `supabase/functions/game-join/index.ts`
- Create: `supabase/functions/game-start/index.ts`
- Create: `supabase/functions/game-list/index.ts`
- Create: `supabase/functions/game-get/index.ts`

**Interfaces:**
- `POST /game-create {name, mode, config, dailyApTime?, apIntervalMinutes?}`
  → `{gameId, inviteCode}`; creator auto-added to `game_players`.
- `POST /game-join {inviteCode}` → `{gameId}`; adds membership. Test games:
  joinable only by creator (bots are added at start).
- `POST /game-start {gameId}` → `{ok}` — creator only; status lobby→active;
  validates config (board fits player count); writes the **initial `game_state`**
  using `createInitialState(config, players)` where players =
  members + configured bots (ids `bot-1..n`, names `Easy Bot 1` etc.); then
  writes `events` seed row? **No** — initial placement is inside
  `createInitialState` (deterministic from seed), so no event needed; event
  seq starts at 1 with the first real action.
- `GET /game-list` → `{games: [{id, name, mode, status, playerCount}]}` for
  games the player is a member of (play mode) + own test games.
- `GET /game-get?gameId` → `{game: {...}, state, events, me}` — members only;
  `events` = current-generation history truncated at `fork_seq`, limited to
  last 500 (client replays from `game_state` + tail).

- [ ] **Step 1–4:** implement each; `game-create` validates config keys
  against a whitelist (board 5–15, startingHp ≥ 1, etc.) with clear errors.
- [ ] **Step 5: curl tests** for the full lifecycle: create → join (2nd
  player) → start → get (state has 2 players placed).
- [ ] **Step 6: Commit** `feat(backend): game lifecycle functions`.

---

### Task B6: tick + bot-fill cron functions

**Files:**
- Create: `supabase/functions/tick/index.ts`
- Create: `supabase/functions/bot-fill/index.ts`
- Create: `supabase/migrations/0003_cron.sql`
- Create: `supabase/functions/_shared/schedule.ts` (shared cron logic)

**Interfaces:**
- `tick` (also callable via secret-bearing POST for testing):
  - Play games: if `daily_ap_time` == current UTC hour/minute-slot and
    `last_tick_at` is not within the current slot → append
    `daily_tick {apGained: config.apPerDay}` via the engine; set
    `last_tick_at`.
  - Test games: same if `now - last_tick_at ≥ ap_interval_minutes`.
  - After a tick, if game has bots → immediately run bot pass (below).
  - Game over (winner set) → status finished.
- `bot-fill`: for each active game with alive bots, for each bot with AP:
  `planBotAction(state, botId)`; if non-null, append `bot_action` event
  (unwrapped inner payload). Repeat until a bot returns null or is out of AP.
- `0003_cron.sql`:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ttt-tick', '0 * * * *',  -- hourly
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization','Bearer ' || current_setting('app.cron_secret')),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 1: Implement schedule.ts** shared by tick + bot-fill.
- [ ] **Step 2: Implement tick + bot-fill.**
- [ ] **Step 3: Manual test** — call `tick` twice on a test game with
  `ap_interval_minutes: 0` (always due): first call grants AP, second within
  the same minute is a no-op; then bots move (events appear; winner
  eventually set in a tiny board config with 2 bots).
- [ ] **Step 4: Commit** `feat(backend): cron tick + bot fill`.

---

### Task B7: Deploy + E2E smoke against hosted instance

**Files:**
- Create: `supabase/functions/README.md` (deploy steps + engine vendoring note)
- Modify: `.github/workflows/deploy.yml` **later in Plan C** (only noted here)

**Interfaces:**
- Produces: hosted `SUPABASE_URL` + anon key values recorded in `app/.env.example`
  (created here; real values live in GH secrets / local `.env` only).

- [ ] **Step 1: `supabase link` + `supabase db push`** to the hosted project.
- [ ] **Step 2: `supabase functions deploy`** all six functions.
- [ ] **Step 3: Register cron secret** — set `app.cron_secret` via
  `supabase secrets set CRON_SECRET=...`; ensure tick rejects requests
  without it (except local).
- [ ] **Step 4: Hosted smoke test** — register → create test game → start →
  move → tick (curl) → verify state advanced.
- [ ] **Step 5: Commit** `feat(backend): deploy docs + hosted smoke`.

---

## Definition of Done (Plan B)

- Local stack: register/signin, game lifecycle, actions, tick, bot-fill all
  pass curl/Deno tests.
- RLS: direct client writes to `events` fail; direct reads of `players`
  return nothing.
- Hosted smoke test passes end-to-end.
- All SQL migrations committed and reproducible via `supabase db reset`.
