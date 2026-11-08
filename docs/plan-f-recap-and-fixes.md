# Plan F — History Recap, SPA 404 Fix, Test-Game Delete Anytime, Join Spacing

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-event "view state" to the history log plus an animated
"replay from here" recap; fix GitHub Pages 404s on nested-route refresh; let
hosts delete their own **test** games in any status (the two prod test games
are `active`, so the current lobby-only rule hides the delete button); add the
missing vertical spacing between "Join game" heading, invite-code label,
input, and button.

**Architecture:** The recap rides the existing scrub machinery:
`scrubIdx → createInitialState + applyEvent replay → displayState`. EventFeed
gains an optional `onView(seq)` callback (a small "View" button per entry) and
HistoryScrubber gains a "Replay from here" button that steps `scrubIdx`
forward on a timer until live. LocalGame records its applied events so local
test games get the same recap. The 404 fix is the standard GitHub Pages
`404.html` redirect + `history.replaceState` restore in `index.html`.

**Tech Stack:** Vite + React 18 + TS, `@ttt/engine`, Supabase Edge Functions
(Deno), vitest, plain CSS.

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`

## Global Constraints

- Mobile-first: works at 400px; touch targets ≥ 44px.
- No UI framework; single `app/src/styles.css` with CSS custom properties.
- Do NOT change the auth migration (0006) or auth flows.
- Play-mode games: deletion stays lobby-only (host intent protection).
  Test-mode games: host may delete in any status (test games are disposable).
- Every task ends with `npm test` + `tsc -b` green and a commit.

---

## Tasks

### Task F1: Test-game deletion in any status

- [ ] `supabase/functions/game-delete/index.ts`: select `mode` too; reject
      non-lobby only for `mode === 'play'`; test games deletable by host in
      any status. Deploy to hosted (was blocked earlier).
- [ ] `app/src/pages/Dashboard.tsx`: show delete when
      `g.createdBy === player?.id && (g.mode === 'test' || g.status === 'lobby')`.
- [ ] `app/src/pages/Dashboard.test.tsx`: host sees Delete on an **active**
      test game; still no Delete on active play games.

### Task F2: GitHub Pages SPA 404 fix

- [ ] `app/public/404.html`: redirect unknown paths to
      `?p=<pathname>&q=<search>` under the app base.
- [ ] `app/index.html`: restore script — on load, if `p` param present,
      `history.replaceState` to `base + p (+ q)` before React mounts.

### Task F3: Join-card spacing

- [ ] `app/src/styles.css`: give forms a vertical flex column with `gap`
      (labels keep their own margins; verify auth + lobby + dashboard forms
      still look right).

### Task F4: View-state-at-event + animated replay recap

- [ ] `app/src/lib/localGame.ts`: record every applied event (player + drip);
      expose `history: GameEvent[]` and `replayTo(count): GameState`.
- [ ] `app/src/components/EventFeed.tsx`: optional `onView(seq)` — each entry
      gets a small "View" button.
- [ ] `app/src/components/HistoryScrubber.tsx`: "Replay from here" button
      (with Stop while running), wired via `onReplay`/`replaying` props.
- [ ] `app/src/pages/Game.tsx`: both views — View enters scrub at that event
      (scrubIdx = index + 1); Replay steps scrubIdx forward ~1 event/sec until
      live. Enable for DB games (any mode) and local test games.
- [ ] `app/src/styles.css`: feed "View" affordance, replay state styling.
- [ ] Tests: EventFeed onView; LocalGame replayTo; Game replay stepping
      (fake timers).
