# Plan D — Game Screen (Board, Actions, Realtime, Jury, Scrubber) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The playable game: SVG board with tap-to-target actions, tank
cards, action bar, live realtime updates, jury screen for dead players, and
the test-mode history scrubber with rewind.

**Architecture:** `Game.tsx` holds `state: GameState` derived from
`game_state` + tail events via `@ttt/engine` `replay`. A Supabase Realtime
subscription on `events` (filtered by game_id) triggers refetch+replay.
Actions POST to `/action`; optimistic UI replays locally, reconciled on the
authoritative response. Scrubber keeps the event list client-side and renders
`replayToSeq` states.

**Tech Stack:** as Plan C + `@supabase/supabase-js` Realtime.

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`
**Overview:** `docs/plans-overview.md`

## Global Constraints

- Same as Plans A–C. Board must be usable at 400px (cells ≥ 28px on a 5×5;
  bigger boards pan/zoom).
- Action buttons always show AP cost; disabled when unaffordable/invalid.
- The engine (`@ttt/engine`) is the single source of validation on the client
  too — buttons disable by attempting the action against a local state copy.

---

### Task D1: Game data hook (replay state + realtime)

**Files:**
- Create: `app/src/lib/useGameEvents.ts`
- Modify: `app/src/lib/api.ts` (typed `GameDetail`)

**Interfaces:**
- Consumes: B5 `game-get` (`{game, state, events, me}`), engine
  `replay`/`applyEvents`.
- Produces: `useGameEvents(gameId): { state: GameState, events: GameEvent[],
  me: PlayerId, loading, error, refresh }` —
  1. fetch detail → `state` = replay(all events) if full history provided
     else trust server `state` + replay tail;
  2. subscribe: `supabase.channel('events:'+gameId)
     .on('postgres_changes', { event: 'INSERT', table: 'events',
       filter: 'game_id=eq.'+gameId }, refetch)` in an effect; cleanup on
     unmount.

- [ ] **Step 1: Failing test** — with mocked `gameGet`, hook exposes replayed
  state; calling the inserted-rows callback triggers `refresh` (spy).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): game state hook + realtime`.

---

### Task D2: Board component (SVG, tap-to-target)

**Files:**
- Create: `app/src/components/Board.tsx`
- Test: `app/src/components/Board.test.tsx`

**Interfaces:**
- Consumes: `GameState`.
- Produces: `<Board state selectedMode onCellTap(pos) />` renders:
  - grid squares (SVG `<rect>` per cell, `data-testid="cell-x-y"`),
  - tanks as circles with initial letters + HP pip ring,
  - range overlay (yellow squares) for the local player's tank,
  - highlight for legal destinations/targets given `selectedMode`,
  - `.board` container with `overflow-x: auto` for large boards (page never
    scrolls horizontally; container does).
- Tap semantics (driven by parent): tap own tank → ActionBar opens; tap
  enemy within range while in attack/give mode → target them.

- [ ] **Step 1: Failing tests** — renders N² cells; own tank marked;
  range overlay matches `inRange` from engine; `onCellTap` fires with `{x,y}`.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): board component`.

---

### Task D3: ActionBar + TankCards + EventFeed

**Files:**
- Create: `app/src/components/ActionBar.tsx`, `TankCard.tsx`, `EventFeed.tsx`
- Test: `app/src/components/ActionBar.test.tsx`, `EventFeed.test.tsx`

**Interfaces:**
- Consumes: `GameState`, engine action validity (try `applyEvent` on a local
  clone in a try/catch).
- Produces:
  - `ActionBar({ state, me, onAction(type, payload) })` — buttons Move /
    Attack / Give AP / Upgrade Range (+cost label); each button disabled when
    `applyEvent` throws for that action (no target selected → attack/give
    need a selected target first; Move enters move mode).
    Buttons ≥44px; shows current AP.
  - `TankCard({ player, isMe, inRange, onTap })` — ❤️ HP, ⚡ AP, 🎯 range;
    tap = select as target.
  - `EventFeed({ log })` — latest-first list from `state.log`.
- [ ] **Step 1: Failing tests** — disabled states for AP poverty; enabled
  attack when enemy in range; feed renders log text.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): action bar, cards, feed`.

---

### Task D4: Game page assembly + optimistic actions

**Files:**
- Create: `app/src/pages/Game.tsx`
- Modify: `app/src/App.tsx` (route `/game/:gameId`, RequireAuth)
- Test: `app/src/pages/Game.test.tsx`

**Interfaces:**
- Consumes: D1 hook, D2/D3 components, B4 `action(gameId, type, payload)`.
- Produces: `/game/:gameId`:
  - status bar: `Day {state.day} · {state.players[me].ap} AP`,
    mode badge (TEST/PLAY).
  - layout per spec's wireframe (board, action bar, own card, in-range
    cards, feed).
  - on action: locally `applyEvent` an optimistic event → POST → on success
    replace state with server's; on failure refetch + toast error text.
  - if `state.winner` → finished banner + `Back to dashboard`.
  - if local player hp ≤ 0 → navigate to `/game/:gameId/jury`.

- [ ] **Step 1: Failing tests** — clicking Move then a legal cell calls
  `action` API with move payload; failure shows error without corrupting
  state (mocked 400 → refetch).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): game page`.

---

### Task D5: Jury screen

**Files:**
- Create: `app/src/pages/Jury.tsx`
- Test: `app/src/pages/Jury.test.tsx`

**Interfaces:**
- Consumes: D1 hook; B4 `action` with `jury_vote {candidateId}`.
- Produces: `/game/:gameId/jury` — read-only board (small), alive-players
  list with **Vote** buttons (disabled after voting this day — derived from
  `state.pendingVotes` for my voterId), your jury status, live feed. Client
  vote validity mirrors engine rules.

- [ ] **Step 1: Failing tests** — vote button calls API with candidateId;
  already-voted disables all vote buttons.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): jury screen`.

---

### Task D6: History scrubber + rewind (test mode)

**Files:**
- Create: `app/src/components/HistoryScrubber.tsx`
- Modify: `app/src/pages/Game.tsx` (test mode only)
- Test: `app/src/components/HistoryScrubber.test.tsx`

**Interfaces:**
- Consumes: `events`, engine `replayToSeq`, B4 `action` with
  `fork {toSeq}`.
- Produces:
  - Slider `0..events.length`; displayed state =
    `replayToSeq(config, specs, events, sliderValue)` rendered in the same
    Board (read-only mode: actions hidden while scrubbing).
  - **Rewind to here** button (test-mode creator only) → POST
    `fork {toSeq}` → refetch → server state now reflects the fork point
    (new generation; new events restart at seq 1 per Plan B's fork
    semantics). Future events remain in the log for the record; the
    scrubber shows the branched history of the current generation.
  - Exit scrub → back to live state.

- [ ] **Step 1: Failing tests** — moving slider renders past state (tank at
  old position); Rewind posts fork with the current slider seq; after fork
  response the live state equals the scrubbed state.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): history scrubber + rewind`.

---

### Task D7: Playwright E2E (mobile viewport) + polish

**Files:**
- Create: `app/e2e/test-mode.spec.ts`
- Modify: `app/package.json` (script `e2e`)

**Interfaces:**
- Consumes: local `supabase start` + functions serve (env `E2E_SUPABASE_URL`),
  dev server.
- Produces: the spec's happy path, iPhone viewport (390×844):
  landing → Test Mode (guest auto-signin) → lobby defaults → start →
  move a tank → attack (bot adjacent after tick force) → scrub history →
  rewind → see state revert. Assert via testids from D2/D3/D6.

```ts
import { test, expect } from '@playwright/test';

test('test mode happy path', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-test').click();
  await expect(page.getByRole('button', { name: /start game/i })).toBeVisible();
  await page.getByRole('button', { name: /start game/i }).click();
  await expect(page.getByTestId('board')).toBeVisible();
  // move: select own tank, then a legal cell
  await page.getByTestId('btn-move').click();
  // tap a highlighted legal cell (first available)
  await page.locator('[data-testid^="cell-"].legal').first().click();
  await expect(page.getByTestId('ap-counter')).not.toHaveText(/^-1|NaN/);
});
```

- [ ] **Step 1: Setup Playwright** (`@playwright/test`, chromium, mobile
  viewport in config).
- [ ] **Step 2: Write spec above**; extend until green against the local
  stack.
- [ ] **Step 3: Run full suites** (`npm test` all workspaces + e2e).
- [ ] **Step 4: Commit** `test(app): e2e test-mode happy path`.

---

## Definition of Done (Plan D)

- A friend can: open the site on a phone → Play → register → create a play
  game → share invite → everyone joins → host starts → all act on their
  phones with realtime updates → someone wins → jury voted along the way.
- Test mode: full config knobs, bots act on ticks, history scrubber rewinds.
- All unit suites + Playwright E2E green; Pages deployment updated.
