# Tank Turn Tactics — Design Doc

**Date:** 2026-11-07
**Status:** Approved (v1)

## Overview

A browser implementation of Halfbrick's "Tank Turn Tactics" (the GDC-2013
office game of alliances and betrayal), played asynchronously over days,
mobile-first, hosted on GitHub Pages with Supabase as the backend.

Friends sign in with a name + password, join games via invite link, spend
Action Points to move / attack / give / upgrade, and try to be the last tank
standing. A configurable private **Test Mode** (vs. seeded-random bots with a
history scrubber) doubles as the dev playground.

## Game rules (v1)

- Square grid board. Each tank starts at a random position with 3 HP, 0 AP,
  range 2.
- Every in-game day at a configured time, every alive player receives +1 AP
  (server cron).
- Actions (each costs AP, validated server-side):
  - **Move** — 1 square orthogonally per 1 AP.
  - **Attack** — 1 HP damage to a tank within range per 1 AP. HP never heals;
    at 0 HP the player dies and joins the Jury.
  - **Give AP** — transfer 1 AP to a player within range per 1 AP spent.
  - **Upgrade range** — +1 range per 2 AP (configurable cost).
- **Jury**: dead players vote daily; living players with 3+ jury votes
  receive +1 bonus AP. Non-votes are wasted. (With revives off, dead players
  also see the board and the event feed; with revives on they see neither —
  just the jury vote and the wait for a heart.)
- **Win**: last tank standing.
- Coordination happens off-board (Discord/iMessage); no in-game chat in v1.

### Configurable rules (v2 — all host checkboxes, default off)

- **Steal AP on kill** (`apStealOnKill`) — the final blow transfers the
  victim's entire AP stash to the killer; off, the victim's AP stays theirs.
- **Heart gifts** (`heartGifts`) — give a heart to a player in range. Costs
  1 of the giver's own HP (never the last one), no AP. A living target below
  max HP gains 1 HP; a dead target **revives** when `revives` is on, at
  1 HP / 0 AP, off the jury. Log entries carry `kind` markers (`kill`,
  `revive`, `heart_spawn`) that drive the live battle feed.
- **Jury haunt** (`juryHaunt`) — the strictly-most-voted living player is
  "haunted": they receive no AP on the next tick. A tie haunts nobody; the
  3-vote jury bonus still applies to the haunted player.
- **Board hearts** (`heartSpawn`) — hearts appear per `heartSchedule`
  (interval / time-of-day / random — same three shapes as AP, independently
  configured, no public timer), optionally delayed by
  `heartSpawnDelayMinutes` after `started_at` to keep the early game
  heart-free. The board holds at most `heartCap` unclaimed hearts at once
  (1-20, default 1): the tick only spawns while under the cap, so a spawn
  due at cap waits until a heart is claimed. Placement is `random` or
  `smart` (seeded distance-field maximization away from all living players
  and every existing heart). Moving onto a heart claims it: +1 HP capped at
  starting HP, or at full HP +2 AP. State carries a `hearts` array
  (legacy snapshots' single `heart` is lifted by `normalizeHeartState` at
  every snapshot load).
- **Gravestones** — dead players stay on the board as named, non-blocking
  markers: tanks drive over graves, hearts may spawn on grave squares,
  bots path through them. `occupantAt` counts living players only.
- **Event log** — during play only final blows and revives are shown (the
  live battle log); the full event feed unlocks post-game (both modes), with
  scrub/replay. No fork UI (backend support stays dormant).

## Architecture

```
GitHub Pages (static)          Supabase (free tier)
┌──────────────────┐          ┌─────────────────────────┐
│  React + Vite    │  HTTPS   │  Postgres               │
│  - Landing page  │ ───────► │   - games (config)      │
│  - Lobby         │          │   - events (append-only)│
│  - Game board    │  Realtime│   - game_state (cached) │
│  - Results       │ ◄─────── │   - players / sessions  │
└──────────────────┘  (WS)    │  pg_cron: daily AP drip │
                              │  RPCs: move/attack/etc  │
                              └─────────────────────────┘
```

### Event sourcing (the rewind mechanism)

- Every action — move, attack, give, upgrade, daily tick, jury vote, bot
  action, fork — is an **append-only event row**
  `(game_id, seq, type, actor_id, payload JSONB, created_at)` with a unique
  constraint on `(game_id, seq)`.
- The authoritative board state is **derived by replaying events** through a
  pure reducer: `state = events.fold(applyEvent, initialState)`.
- A materialized `game_state` row (per game: `seq`, `state JSONB`) is rebuilt
  on each new event so reads stay cheap.
- **Rewind to event N**: append a `fork` event; state derives from events
  1..N of the current (or prior) branch. Old events are never deleted — they
  remain in the log for the record.
- **Restart from a point**: replay to N, then continue appending. Same
  mechanism; the future is simply re-written from there.

### Shared game engine

The reducer (`applyEvent`) is pure TypeScript, no I/O, in a package shared by
client and server code paths:

- **Client** uses it for optimistic UI and instant history scrubbing
  (scrubbing = re-running the reducer up to event N — no network round-trip).
- **Supabase Edge Functions** (TypeScript on Deno) re-run it server-side as
  the authority before appending — Edge Functions, not stored SQL functions,
  because stored functions can't run the shared TS engine. They import this
  package directly.
- **Bots** act by the server appending ordinary `bot_action` events.
  Behavior is random with per-difficulty tuning (easy/medium/hard), seeded
  per game so any game is reproducible. Smarter bot logic is a future
  upgrade; the interface (append events) does not change.

### Determinism

- Random placement, seeded PRNG (seed stored in `games.config`).
- Bot decisions seeded by `(seed, seq)` so replays reproduce identical
  bot behavior.

## Data model (Supabase / Postgres)

| Table | Columns (abridged) | Notes |
|---|---|---|
| `players` | id, name UNIQUE, password_hash, created_at | bcrypt hashes only |
| `sessions` | token, player_id, expires_at | opaque bearer tokens |
| `games` | id, name, mode ('play'\|'test'), config JSONB, status ('lobby'\|'active'\|'finished'), created_by, daily_ap_time, ap_interval_minutes, last_tick_at, last_heart_at, started_at | config holds all knobs; started_at anchors 'random' periods (0012) |
| `game_players` | game_id, player_id, is_bot, bot_difficulty, joined_at | |
| `events` | game_id, seq, type, actor_id, payload JSONB, created_at | append-only; UNIQUE (game_id, seq) |
| `game_state` | game_id, seq, state JSONB | materialized replay cache |

`games.config` JSONB fields (all lobby-configurable, at least in Test Mode):
board size, starting-position count, starting HP/AP, AP per day, range
upgrade cost, base range, tick time-of-day, bot count, bot difficulties.

`games.config` JSONB optional fields (v2 rules): `apSchedule`
('interval'\|'timeOfDay'\|'random'), `apPeriodMinutes`, `apStealOnKill`,
`heartGifts`, `revives`, `juryHaunt`, `heartSpawn`, `heartSchedule`,
`heartIntervalMinutes`, `heartTimeOfDay`/`heartTimezone`,
`heartPeriodMinutes`, `heartSpawnDelayMinutes`, `heartCap` (1-20),
`heartPlacement` ('random'\|'smart'), `showPlayerNames` — all validated by
game-create/game-update, which delete the fields of an abandoned schedule
shape (and all heart fields when `heartSpawn` turns off).

**Tick-speed override:** play games resolve their AP schedule per above
(legacy play = daily time-of-day). Test games set `ap_interval_minutes`
(e.g. 2), and the same every-minute cron grants AP to any test game whose
interval has elapsed — one job serves both modes.

## Accounts & security

- Registration = name + password (bcrypt). Sign-in returns a session token
  stored in localStorage; all requests carry it as a bearer token. (HTTP-only
  cookies don't survive the GitHub Pages ↔ Supabase cross-domain cleanly.)
- **Postgres RLS is the authority.** The client talks to Supabase directly;
  policies enforce membership-based reads. Lobby listings expose minimal
  info only.
- **Actions go through Edge Functions only** (`move`, `attack`, `give_ap`,
  `upgrade_range`, `jury_vote`, …). The client never inserts event rows
  directly — an RLS policy denies all client INSERTs on `events`; only the
  service role (Edge Functions and the cron job) writes. Each endpoint
  validates: actor is alive and a member, AP sufficient, target in range,
  destination empty — then appends the event and refreshes `game_state`.
- Test-mode games are private to their creator.
- Threat model honesty: a player can always act *as themselves* (their token
  is on their device) — but every action is rule-validated server-side, and
  no one can move another player's tank or read private game data. Correct
  level of security for a friends-and-bots game without a custom server.

### AP + heart scheduling

`pg_cron` fires **every minute** (0003 hourly → 0010 `* * * * *`; 0011 moved
the cron secret from the unset GUC into the `app_settings` table) and
invokes the `tick` Edge Function, which per active game evaluates two
independent due-checks — AP (`daily_tick` event) and hearts
(`heart_spawn` event) — over three schedule shapes:

- **interval** — due once `ap_interval_minutes` (the column, kept in sync
  with config by game-update) has elapsed since the last grant.
- **timeOfDay** — due in the first invocation at/after the configured
  wall-clock time (config `apTimeOfDay`/`apTimezone`, falling back to the
  `daily_ap_time` column) that is on a LATER local day than the last grant:
  at most once/day, downtime catches up exactly once.
- **random** — one grant minute per period of length P anchored at
  `started_at`, derived deterministically from the game seed:
  `offset(i) = floor(mulberry32(hashSeed(seed:ap:i))() * P)`; due iff now is
  past that minute and the last grant happened before it. No public
  countdown (the client hides the timer in this mode).

Hearts run the same three shapes off `heartSchedule` with their own
`last_heart_at` column and a seeded rng (`seed:heart:<period>`); spawn
position comes from the engine's `heartSpawnPos(state)`. Bots act after the
drip/spawn. Legacy configs (no `apSchedule`) keep the old resolution: play
mode → timeOfDay, test mode → interval.

## Frontend

React + Vite + TypeScript, hosted on GitHub Pages.

- **Landing page** — three large touch targets:
  - **Play** → sign-in/register, then: game list, joinable invite links,
    create game.
  - **Instructions** → static rules page (no auth): stats, actions, jury,
    day cycle.
  - **Test Mode** → skips real auth (throwaway local session), private
    configurable lobby: board size, starting positions, HP/AP economy, bot
    count/difficulty, tick-speed override — then straight into the game.
- **Game screen (mobile-first):** status bar (day / AP), SVG board
  (tap-to-target; pinch/scroll on big boards), large action buttons
  (≥44px targets), your tank card, in-range player cards (tap to target),
  live event feed. Desktop: same layout, board larger, tank cards in a
  sidebar.
- **Realtime:** Supabase Realtime subscription on `events` for the current
  game — friend moves appear in ~1s. No polling loops.
- **History scrubber (Test Mode):** slider over the event log; state renders
  by reducer replay client-side. "Rewind to here" appends a `fork` event.
- **Jury screen:** dead players see the board, vote daily, watch the drama.

## Non-goals for v1

- In-game chat (friends will coordinate in Discord anyway).
- Public lobbies (invite-link games only).
- Fog of war, spying, action queues (original's extra features).
- Smart bot AI (random-by-difficulty now; interface leaves room).

## Testing strategy

- **Engine:** the reducer gets the heaviest coverage — pure function, so
  table-driven tests: given event sequences → expected states; illegal
  events rejected. Rewind/fork behavior tested at this layer.
- **RPC validation:** each rule (AP cost, range, alive, cell-empty) as an
  integration test against a local Supabase instance.
- **Bots:** seeded reproducibility test — same seed, same event stream.
- **E2E:** Playwright on mobile viewport for the landing → test-mode → play
  a few actions → scrub history happy path.
- No real games economy risk in v1, so no load testing beyond sanity.

## Deployment

- **Frontend:** GitHub Pages via GitHub Actions on push to main (Vite
  `base` configured for the repo path).
- **Backend:** one Supabase project; schema + RLS applied via migration SQL
  files committed to the repo; Edge Functions (actions + `tick`) and the
  `pg_cron`→pg_net schedule registered with the Supabase CLI. Frontend reads
  the Supabase URL + anon key from build-time env.
