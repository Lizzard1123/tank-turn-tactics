# Tank Turn Tactics

A mobile-first, async turn-based tactics game for playing with friends — inspired by the office game from Halfbrick's GDC 2013 talk. One action a day keeps the war slow-burning; death just changes your job.

![CI](https://github.com/Lizzard1123/tank-turn-tactics/actions/workflows/deploy.yml/badge.svg)

## The rules (v1 — "lean core + The Jury")

- Every tank starts with **3 HP** and **0 AP**; you gain **+1 AP per day**.
- **Move** 1 cell (orthogonal) — 1 AP
- **Attack** a tank in range — 1 AP (1 damage)
- **Give AP** to any tank in range — 1 AP transfers 1:1
- **Upgrade Range** — +1 range for `upgradeCost` AP (starts at 2)
- **The Jury** — dead players stay in the game: each day they may cast one vote; a candidate with ≥ 3 votes gains +1 AP
- **Last tank standing wins.**

## Play modes

| Mode | Pace | What it's for |
|---|---|---|
| **Play** | Daily AP drop at a fixed time | The real async game with friends |
| **Test** | AP on a short interval, full config knobs | Trying rules, board sizes, bot difficulties |

Test mode lets the host tune board size (5–15), HP, starting AP, base range, AP/day, upgrade cost, AP interval, and seed the lobby with easy/medium/hard bots. Test-mode hosts can also **rewind history**: scrub the event log back to any point of the current generation and fork the game from there.

## Tech

| Layer | Choice |
|---|---|
| Engine | Pure TypeScript, **zero runtime deps**, event-sourced (every mutation is an event; state = `replay(events)`) |
| Backend | Supabase — Postgres + RLS (default-deny), Edge Functions (Deno), `pg_cron` → `pg_net` tick scheduler |
| Auth | Name + password (bcrypt), first-party JWT session tokens |
| Frontend | React + Vite, mobile-first, GitHub Pages |
| Realtime | supabase-js `postgres_changes` on the append-only `events` table |
| Determinism | All randomness flows through a seeded `mulberry32` PRNG; seeds live in `games.config.seed` |

The event-sourcing design is load-bearing: the client replays the same events the server wrote, which is what makes the history scrubber and fork/rewind work without a server round-trip per frame.

## Project layout

```
packages/engine/     @ttt/engine — reducer, RNG, bots, replay; shared by client and server
app/                 @ttt/app — React frontend (Vite)
supabase/
  migrations/       SQL schema + RLS + cron
  functions/        Edge Functions (register, signin, game-*, action, tick, bot-fill)
docs/               design doc + implementation plans (flat, no subfolders)
```

## Local development

```bash
# 1. dependencies
npm install

# 2. local Supabase stack (requires supabase CLI + Docker)
supabase start

# 3. edge functions (keep running; reads engine from packages/engine)
cp supabase/.env.example supabase/.env.local   # fill from `supabase status`
supabase functions serve --env-file supabase/.env.local

# 4. frontend
npm run dev --workspace @ttt/app
```

Open http://localhost:5173 — **Test Mode** signs you in as a guest and drops you in a lobby with 3 easy bots by default.

For function-local details (env vars, engine sync into `supabase/functions/_shared/engine_src/`), see `supabase/functions/README.md`.

## Tests

```bash
npm test            # vitest: engine (49) + app (48)
npm run e2e --workspace @ttt/app   # Playwright happy path (needs the local stack running)
bash supabase/functions/smoke.sh   # 15 backend integration checks against the local stack
```

## Deployment

- Frontend: **GitHub Pages** via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (push to `main`).
- Backend: hosted Supabase project — set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as repo secrets, and apply `supabase/migrations/` + `supabase functions deploy` (step-by-step in `supabase/functions/README.md`).

## Docs

- [Design doc](docs/2026-11-07-tank-turn-tactics-design.md) — the game's design and rationale
- [Plans overview](docs/plans-overview.md) — how the build was split (engine → backend → shell → game screen), with links to each plan
