# Plan G — Prod Bug Fixes: Delete, AP Tick, Realtime, Correct History, Feedback Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every issue from the 2026-11-08 playtest: invisible delete
(stale `game-list` deploy + missing CORS DELETE method), AP never arriving
(cron secret unset → tick 401s, hourly-only schedule, realtime off),
laggy actions (no realtime publication + no optimistic apply), corrupted
replay states (superseded pre-fork events in history), history UX rebuilt
(feed keeps full list with highlight + timestamps + metadata dropdown; the
scrubber box dies), horizontal HP bars, real flag images, profile
discoverability, create→lobby navigation.

**Architecture:** Ops fixes are migrations + redeploy + secret wiring. The
canonical timeline fix introduces a `game_forks` table recording each fork's
truncation point per parent generation, and `game-get` assembles history as
"per generation: events ≤ that generation's fork point". The client keeps
full-history replay, which becomes correct once history is canonical. The
events feed becomes the single history surface (no separate scrubber panel).

**Tech Stack:** Vite + React 18 + TS, `@ttt/engine`, Supabase Edge Functions
(Deno), Postgres (pg_cron, pg_net, supabase_realtime publication), vitest,
plain CSS. Flags: `flag-icons` npm package (4x3 SVGs copied to `public/flags`
at build).

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`

## Global Constraints

- Mobile-first: works at 400px; touch targets ≥ 44px.
- No UI framework; single `app/src/styles.css` with CSS custom properties.
- Do NOT change the auth migration (0006) or auth flows.
- Play-mode games: deletion stays lobby-only. Test-mode: host deletes in any
  status (unchanged from plan F).
- Every task ends with `npm test` + `tsc -b` (app is the gate) green and a
  commit. Prod ops steps (deploy/migration/secret) run once at the end.
- Prod DB writes only where this plan names them (migration 0007/0008,
  `app.cron_secret` setting, secret set, function deploys).

---

## Tasks

### Task G1: Server correctness — canonical history across forks

The replay corruption: `game-get` returns every event of every generation ≤
current, including the discarded post-fork-point tail of older generations.
Full-history replay then applies a branch the game abandoned — tanks teleport.

- [ ] Migration `supabase/migrations/0007_game_forks.sql`:
  ```sql
  create table if not exists game_forks (
    game_id uuid not null references games(id) on delete cascade,
    parent_generation int not null,
    to_seq bigint not null,
    primary key (game_id, parent_generation)
  );
  -- backfill: current games know only the latest fork point
  insert into game_forks (game_id, parent_generation, to_seq)
    select id, cur_generation - 1, fork_seq from games where fork_seq is not null
    on conflict do nothing;
  ```
- [ ] `supabase/functions/action/index.ts` fork branch: also insert the
      `game_forks` row `(gameId, game.cur_generation, toSeq)` (the parent
      generation is the CURRENT one at fork time, read before bumping).
- [ ] `_shared/history.ts` (new): pure `canonicalHistory(rows, forks)`
      — rows: `{seq, generation, ...}[]`, forks: `{parentGeneration, toSeq}[]`;
      returns events of generation g with `seq <= fork(g).toSeq` (missing fork
      ⇒ keep all), ordered by (generation, seq). Deno test
      `_shared/history_test.ts`: mixed generations, fork cut, multi-fork chain.
- [ ] `game-get`: fetch `game_forks` rows, build history through
      `canonicalHistory`. Old "approximate by keeping everything" comment goes.
- [ ] Client `DbGameView` full-history replay stays as-is (now correct).

### Task G2: Realtime + optimistic actions (lag)

- [ ] Migration `supabase/migrations/0008_realtime_publication.sql`:
  ```sql
  -- postgres_changes subscribers only get tables in the realtime publication
  alter publication supabase_realtime add table events;
  ```
      (idempotent guard: only add if not already a member).
- [ ] `Game.tsx` `doAction` (DbGameView): after the optimistic
      `applyEvent(state, optimisticEvent)` validation SUCCEEDS, also commit it
      locally — `setState(applyEvent(state, optimisticEvent))` and append to a
      local pending list merged into `history` display — so the board updates
      instantly; the POST + realtime refetch then reconcile (same event seq).
      On failure path (server rejects), `refresh()` rolls back as today.
- [ ] Test in `Game.test.tsx`: with a delayed `action` mock, board/AP update
      immediately after click, before the promise resolves.

### Task G3: Truthful AP timer + no reset on scrub

- [ ] `DbGameView` apRemaining: derive ONLY from live `state` (config +
      `tickClockMinutes`), not `displayState`; effect deps are the primitive
      values, so scrubbing never recreates the countdown. While scrubbing the
      timer keeps ticking.
- [ ] Test: scrub to history, advance timers, timer value continues from
      where it was (not reset).

### Task G4: Dashboard & navigation

- [ ] Create flow: on success `navigate(\`/lobby/${r.gameId}\`)` immediately
      (creator is auto-membered server-side; lobby shows the invite code).
      Delete the `created` state + invite-result box.
- [ ] Refetch the games list after create, join, and delete (no stale
      "No games yet" until reload).
- [ ] Delete affordance visible: render inside the `li` as a small bordered
      button in a row with the game card (not a bare red text link below).
- [ ] Identity clarity: under the greeting add
      "Playing as guest-hova13 — temporary guest. Register to keep a name and
      stats." linking `/auth` (only when `isGuest`).
- [ ] Navigation: Dashboard header gains a `Profile` link; Landing menu gains
      `Dashboard` and `Profile` items (signed-in only).
- [ ] Tests: create navigates to lobby; list refetches after delete.

### Task G5: Events feed as the single history surface

- [ ] Remove the `HistoryScrubber` panel from both `LocalGameView` and
      `DbGameView`; delete `HistoryScrubber.tsx` + its test (its job is now
      the feed's).
- [ ] `EventFeed` rework. Props:
      `{ entries: FeedEntry[]; activeSeq: number | null; live: boolean;
         onView(seq): void; onReplay(): void; onStop(): void;
         replaying: boolean; onFork?(seq: number): void; canFork: boolean }`
      where `FeedEntry = { seq, type, actorId, createdAt, text, isFuture? }`.
      Behavior:
      - Always render the FULL list (from `history`, not the scrubbed log);
        events after the active one stay visible but dimmed (`li.future`).
      - Active event highlighted (`li.active`, signal border).
      - Timestamp under every entry in a `<details>` "Details" dropdown:
        rendered time, seq, actor, raw type. 
      - Each entry keeps its `View` button.
      - Card header controls: `Replay from here` / `Stop replay` while
        scrubbing, and `Back to live` when not live. `Rewind to here` lives
        inside the Details dropdown (host + test games only).
- [ ] Both views: `viewEvent`/scrub state unchanged internally; the feed's
      `entries` come from `game.history` / `history` (canonical), texts from
      the entry's own `log` line if present else synthesized per type.
- [ ] Tests: full list visible while scrubbed; active highlighted; future
      entries dimmed class; timestamp present; rewind only when canFork.

### Task G6: Board polish — horizontal HP bar

- [ ] `Board.tsx`: replace per-HP vertical sticks with ONE horizontal bar at
      the cell bottom: width = `hp / config.startingHp * usableWidth`, height
      ~`CELL*0.14`, rust fill, ink stroke. `testid="life-bar-{id}"`.
- [ ] Update `Board.test.tsx` bar assertions.

### Task G7: Real flags from flag-icons

- [ ] `npm i flag-icons` (workspace app). Build copies
      `node_modules/flag-icons/flags/4x3/*.svg` → `app/public/flags/`
      (prebuild script; `public/flags` git-ignored).
- [ ] `app/src/lib/flags.ts`: replace generated SVG layouts with
      deterministic country assignment: FNV-1a hash of playerId over a sorted
      ISO 3166-1 alpha-2 list (the codes shipped by flag-icons 4x3); export
      `flagForPlayerId(id): string` returning the CODE, and
      `flagUrl(id): string` = `${import.meta.env.BASE_URL}flags/${code}.svg`.
- [ ] Call sites: Board tank decoration uses `<image href={flagUrl(id)}>`;
      Profile fallback div uses `backgroundImage: url(flagUrl(...))`.
- [ ] Tests: same player id ⇒ same code always; code ∈ shipped list;
      flagUrl starts with BASE_URL.

### Task G8: Deploy + verify (ops pass)

- [ ] Deploy functions: game-get, action, game-list, game-delete (CORS fix:
      `_shared/cors.ts` gains `'Access-Control-Allow-Methods':
      'GET, POST, DELETE, OPTIONS'` — do this edit in G8's prep).
- [ ] Apply migrations to prod (`supabase db push` or psql for 0007/0008).
- [ ] Wire the cron secret: generate a strong secret, `supabase secrets set
      CRON_SECRET=<v>`, then `ALTER DATABASE postgres SET app.cron_secret =
      '<v>'` via psql. Reschedule `ttt-tick` to `'* * * * *'` (every minute;
      `dueForTick` still gates per game — play games check the daily hour).
- [ ] Verify live: delete button appears for a fresh guest's own test game;
      DELETE succeeds through the browser (consume the scratch game
      `bf281afa-9399-47d1-ad31-7f1e730ff680`); `net._http_response` shows 200
      for the tick call; a `daily_tick` event lands within ~2 minutes on a
      test game; realtime INSERT triggers refetch (two-browser check or event
      watcher).
