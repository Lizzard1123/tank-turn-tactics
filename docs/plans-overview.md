# Tank Turn Tactics — Implementation Plans Overview

> **For agentic workers:** These four plans are executed in order A → B → C → D.
> Each plan is self-contained: REQUIRED SUB-SKILL per plan — use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the v1 of Tank Turn Tactics defined in
`docs/2026-11-07-tank-turn-tactics-design.md` (read it first — the plans argue
from it).

**Architecture:** Event-sourced game engine (pure TS, shared client+server),
Supabase (Postgres + RLS + Edge Functions + pg_cron) as the backend authority,
React+Vite mobile-first frontend on GitHub Pages.

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`

## Plan order

| Plan | Doc | Deliverable |
|---|---|---|
| A | `docs/plan-a-engine.md` | `packages/engine` — reducer, RNG, bots, rewind; fully unit-tested |
| B | `docs/plan-b-backend.md` | Supabase schema, RLS, auth + action + tick Edge Functions, cron |
| C | `docs/plan-c-frontend-shell.md` | Deployable app: landing, instructions, auth, dashboard, lobby, test-mode config |
| D | `docs/plan-d-game-screen.md` | Playable game: board, actions, realtime, jury, history scrubber |

Each plan ends with working, testable software. B depends on A (imports the
engine). C depends on B (auth + games API). D depends on C.

## Repository file structure (final state)

```
.
├── docs/                          # ALL docs live flat here (user preference)
│   ├── 2026-11-07-tank-turn-tactics-design.md
│   ├── plans-overview.md
│   ├── plan-a-engine.md
│   ├── plan-b-backend.md
│   ├── plan-c-frontend-shell.md
│   └── plan-d-game-screen.md
├── package.json                   # npm workspaces root
├── packages/
│   └── engine/
│       ├── package.json           # name: @ttt/engine, no deps
│       ├── src/
│       │   ├── types.ts           # GameState, GameEvent, GameConfig, PlayerState
│       │   ├── rng.ts             # mulberry32 seeded PRNG
│       │   ├── state.ts           # createInitialState
│       │   ├── reducer.ts         # applyEvent (pure)
│       │   ├── replay.ts          # replay / replayToSeq (rewind)
│       │   ├── bots.ts            # planBotAction (seeded, per difficulty)
│       │   └── index.ts           # public exports
│       └── test/
│           ├── rng.test.ts
│           ├── state.test.ts
│           ├── actions.test.ts    # move/attack/give/upgrade
│           ├── ticks.test.ts      # daily_tick + jury
│           ├── rewind.test.ts     # fork/replayToSeq
│           └── bots.test.ts
├── supabase/
│   ├── migrations/
│   │   ├── 0001_schema.sql        # tables + indexes
│   │   ├── 0002_rls.sql           # policies + deny client event INSERT
│   │   └── 0003_cron.sql          # pg_cron → pg_net tick schedule
│   └── functions/
│       ├── _shared/engine.ts      # re-export shim from @ttt/engine
│       ├── register/index.ts
│       ├── signin/index.ts
│       ├── action/index.ts        # move|attack|give_ap|upgrade_range|fork
│       ├── bot-fill/index.ts      # appends bot events for due games
│       └── tick/index.ts          # daily/interval AP + jury resolution
├── app/
│   ├── package.json               # name: @ttt/app
│   ├── vite.config.ts             # base for GitHub Pages
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                # router + auth gate
│       ├── lib/
│       │   ├── supabase.ts        # client (URL/anon key from env)
│       │   ├── api.ts             # typed calls to Edge Functions
│       │   ├── auth.tsx           # session context (localStorage token)
│       │   └── useGameEvents.ts   # realtime subscription hook
│       ├── pages/
│       │   ├── Landing.tsx        # Play / Instructions / Test Mode
│       │   ├── Instructions.tsx
│       │   ├── Auth.tsx           # register + sign-in
│       │   ├── Dashboard.tsx      # game list, create, join via link
│       │   ├── Lobby.tsx          # config screen (full knobs in test mode)
│       │   ├── Game.tsx           # board + actions + feed + scrubber
│       │   └── Jury.tsx           # dead-player voting screen
│       └── components/
│           ├── Board.tsx          # SVG grid, tap-to-target
│           ├── TankCard.tsx
│           ├── ActionBar.tsx      # ≥44px buttons
│           ├── EventFeed.tsx
│           └── HistoryScrubber.tsx
└── .github/workflows/deploy.yml   # GH Pages deploy on push to main
```

## Global Constraints

- **TypeScript strict mode** everywhere; `@ttt/engine` has **zero runtime
  dependencies** (it must run in Deno and the browser).
- **Monorepo via npm workspaces** (root `package.json` with
  `"workspaces": ["packages/*", "app"]`).
- Engine events are the only state mutations; **the client never writes
  event rows directly** — only Edge Functions and cron (service role) write.
- Passwords: **bcrypt** (`bcryptjs` server-side), never plaintext, never
  client-side hashed-and-trusted.
- Mobile-first: primary touch targets ≥ 44px; layout must work at ~400px
  viewport width; board scales down gracefully.
- TestMode uses `mode='test'` games with `ap_interval_minutes`; real games
  use `daily_ap_time`.
- All docs flat under `docs/` (no nested spec/plan folders).
- Every commit message ends with
  `Co-Authored-By: Claude Code <noreplay@anthropic.com>`.
  (Exact line: `Co-Authored-By: Claude Code <noreply@anthropic.com>`.)
- Test runner: **vitest** (engine + app units); **Playwright** for app E2E;
  supabase CLI local stack for backend integration tests.
- Determinism: all randomness flows through the seeded `mulberry32` PRNG;
  seeds live in `games.config.seed`.
