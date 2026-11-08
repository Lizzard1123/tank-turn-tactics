# UX Round H Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ten playtest fixes from UX round H: Games page (no Dashboard), finished-games expander, AP timer stops on finished games, guest join gate, the seq-collision scrubber fix (server cumulative cuts + index-based client), board animations (slide / red bullet / green bullet / pulse), and button-styled nav links.

**Architecture:** Client is React + vitest + testing-library (workspace `app`). Server is Supabase edge functions (Deno) — this plan touches only `_shared/auth.ts`, `_shared/history.ts`, and `game-join`, verified by the existing Deno test file plus a live smoke pass. The board refactor moves tanks out of the per-cell loop into an id-keyed overlay layer so React keeps the element across moves and CSS transitions animate it.

**Tech Stack:** React 19 + react-router, @ttt/engine (workspace `packages/engine`), Supabase edge functions (Deno), vitest + testing-library, Playwright MCP for live smoke.

**Spec:** `docs/2026-11-08-ux-round-h-design.md` — the binding authority; this plan argues from it.

## Global Constraints

- Copy, verbatim: page header **"Games"** (no "Dashboard" branding); expander summary **`Finished games (n)`**; server gate error **`register to join shared games`** (403); client guest copy **`Guests can't join shared games — register first.`** with a Register link to `/auth`.
- data-testids (exact): `finished-games-toggle`, `finished-game-<id>`, `ap-timer`, `winner-banner`, `tank-<playerId>`, `fx-attack`, `fx-give_ap`, `fx-pulse`.
- Server changes are limited to: `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/history.ts`, `supabase/functions/game-join/index.ts`. **No engine changes** (`packages/engine` untouched); dead tanks are hidden VISUALLY only — `occupantAt` move-blocking unchanged.
- Do NOT touch `supabase/migrations/*` or auth config (`0006` / `double_confirm_changes` stays as-is).
- After Tasks 5–7 merge, redeploy edge functions `game-get`, `action`, `game-join` (Task 11). `tick` is NOT redeployed (no changes to it).
- Test commands: app tests `npm test --workspace app -- <path>` from repo root; functions tests `deno test --allow-all supabase/functions/_shared/history_test.ts`.
- Every commit message ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Design-doc calls already settled: dead tanks hidden; timeline fix server + client; name change dropped (replaced by the guest gate).

## Review Focus

Failure modes the spec implies that unit tests below don't fully exercise — each is pinned by the named test; verify them deliberately during review:

1. **Double fork rewinding below an earlier fork's cut** → duplicate seqs. Server must emit none (Task 7 test); client must highlight the exact clicked row even in legacy duplicate-seq history (Task 8 regression test).
2. **Zero finished games** → the expander must be entirely absent, not render "Finished games (0)" (Task 3 test).
3. **Guest clicking Play** with `VITE_CANONICAL_INVITE_CODE` configured, and guest opening `?join=CODE` → register prompt, never a raw 403 string or a silent join attempt (Task 6 tests; live smoke re-checks the server 403 path).
4. **Scrubbing history of a won/finished game** → the AP timer must never render from a scrubbed or finished state (Task 4 tests).
5. **Attacking a tank to 0 HP** → the tank hides but the bullet still animates to its (still-known) tile: state keeps dead players' positions (Task 10 test asserts fx present when target hp = 0).

---

### Task 1: Dashboard → "Games" page (route, header, Landing, link retargets)

**Files:**
- Modify: `app/src/App.tsx:34` (add `/games` route)
- Modify: `app/src/pages/Dashboard.tsx:99` (h1)
- Modify: `app/src/pages/Landing.tsx:16` (remove Dashboard menu item)
- Modify: `app/src/pages/Game.tsx:135,142,392,399` (Exit + winner-banner links)
- Modify: `app/src/pages/Profile.tsx:128`, `app/src/pages/Play.tsx:20,40`
- Modify: `app/src/pages/Lobby.tsx` (any `/dashboard` links found)
- Test: `app/src/pages/Landing.test.tsx`, `app/src/pages/Dashboard.test.tsx`, `app/src/pages/Game.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: canonical route `/games` rendering the Dashboard component; `/dashboard` still works (alias). All in-app links point at `/games`. Game.test.tsx's mock route `/dashboard` (Game.test.tsx:52) becomes `/games` "DASHBOARD" → renamed marker "GAMES PAGE".

- [ ] **Step 1: Write the failing tests**

In `Landing.test.tsx`, add/update:
```tsx
test('main menu has no Dashboard button (Play is the way in)', () => {
  // render Landing with an authed player as the existing tests do
  expect(screen.queryByTestId('btn-dashboard')).not.toBeInTheDocument();
  expect(screen.getByTestId('btn-play')).toBeInTheDocument();
});
```
In `Dashboard.test.tsx`, update the heading assertion to:
```tsx
await screen.findByRole('heading', { name: /games/i });
```
(no heading on the page may match "Dashboard" anymore). In `Game.test.tsx`: change the mock route `path="/dashboard"` to `path="/games"` with marker `GAMES PAGE`, and update the finished-game test (Game.test.tsx:136) to `expect(screen.getByText(/back to games/i)).toBeInTheDocument();`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace app -- src/pages/Landing.test.tsx src/pages/Dashboard.test.tsx src/pages/Game.test.tsx`
Expected: FAIL — `btn-dashboard` still present; heading still "Dashboard"; banner text still "Back to dashboard".

- [ ] **Step 3: Implement**

- `App.tsx`: add `<Route path="/games" element={<RequireAuth><Dashboard /></RequireAuth>} />` above the `/dashboard` route (keep `/dashboard` as the alias).
- `Dashboard.tsx:99`: `<h1>Games</h1>`.
- `Landing.tsx`: delete the `btn-dashboard` Link.
- Retarget every in-app link/navigation: `Game.tsx` Exit links (both views, lines 135/392) → `to="/games"`; winner-banner "Back to dashboard" → "Back to games" with `to="/games"` (lines 142/399); `Profile.tsx:128` → `to="/games"` (text stays "Back to dashboard" until Task 2 rewords it — change text to "Back to games" here); `Play.tsx` navigates `'/dashboard'` → `'/games'` (lines 20/40); grep for stragglers:
  Run: `grep -rn "dashboard" app/src --include="*.tsx" | grep -v "App.tsx"` and retarget any remaining route links (Lobby etc.).
- `Game.test.tsx:52` mock route: `/games` + marker `GAMES PAGE`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/pages/Landing.test.tsx src/pages/Dashboard.test.tsx src/pages/Game.test.tsx src/pages/Play.test.tsx src/pages/Profile.test.tsx src/pages/Lobby.test.tsx`
Expected: PASS. If Play/Profile/Lobby tests referenced the old links, update assertions to `/games`.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(app): /games is the canonical games page; Dashboard button dropped

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Button-styled nav links

**Files:**
- Modify: `app/src/styles.css` (new `.btn` class after `.link-button`, line ~147)
- Modify: `app/src/pages/Dashboard.tsx:96-97`, `app/src/pages/Profile.tsx:128`, `app/src/pages/Game.tsx:135,392`
- Test: `app/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS class `.btn` — a real-button look matching the site's card buttons — applied to the four nav spots. **Call made here (deviating from the design doc's letter):** the design doc said "`.link-button` gains button styling", but `.link-button` is also used for in-feed controls (View / Replay / Back to live). Restyling it globally would bloat the feed toolbar beyond what the user asked for. So `.link-button` stays a quiet text link; nav links get the new `.btn` class.

- [ ] **Step 1: Write the failing test**

In `Dashboard.test.tsx`:
```tsx
test('top nav links render as buttons (.btn class), not underlined text links', async () => {
  vi.mocked(api.gameList).mockResolvedValue({ games: [] });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  const home = await screen.findByRole('link', { name: /home/i });
  expect(home.className).toContain('btn');
  expect(screen.getByRole('link', { name: /profile/i }).className).toContain('btn');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace app -- src/pages/Dashboard.test.tsx`
Expected: FAIL — className is `link-button` only.

- [ ] **Step 3: Implement**

`styles.css`, after the `.link-button` block:
```css
.btn {
  background: var(--paper-raised);
  color: var(--ink);
  cursor: pointer;
  box-shadow: var(--shadow);
  padding: 0.45rem 0.9rem;
  text-decoration: none;
  display: inline-block;
  min-height: 0;
  border: none;
}
.btn:not(:active):hover { filter: brightness(1.06); }
.btn:active { transform: translate(3px, 3px); box-shadow: none; }
```
Apply `className="link-button btn"` to: Dashboard's `← Home` and `Profile` links, Profile's "Back to games", both Game Exit links.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/pages/Dashboard.test.tsx src/pages/Profile.test.tsx src/pages/Game.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/styles.css app/src/pages/Dashboard.tsx app/src/pages/Profile.tsx app/src/pages/Game.tsx app/src/pages/Dashboard.test.tsx
git commit -m "feat(app): nav links styled as real buttons (.btn)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Finished-games expander

**Files:**
- Modify: `app/src/pages/Dashboard.tsx` (game-list section, lines ~108-136)
- Test: `app/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `GameSummary.status` ('lobby' | 'active' | 'finished') from `lib/api`.
- Produces: list split — `active` = status lobby or active (renders as today); `finished` = everything else, under `<details className="finished-games">` with `<summary data-testid="finished-games-toggle">Finished games (n)</summary>`, hidden entirely when n = 0. Rows in the expander carry `data-testid="finished-game-<id>"`. Delete buttons follow the EXISTING rule (host test games incl. finished ones; `game-delete` already permits any test game and tombstones into `finished`).

- [ ] **Step 1: Write the failing tests**

```tsx
test('finished games live under a collapsed expander, not the main list', async () => {
  vi.mocked(api.gameList).mockResolvedValue({
    games: [
      { id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' },
      { id: 'g2', name: 'Old War', mode: 'play', status: 'finished', playerCount: 4, created_at: '', createdBy: 'p1' },
    ],
  });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(await screen.findByText('Office War')).toBeInTheDocument();
  expect(screen.queryByText('Old War')).not.toBeInTheDocument();
  expect(screen.getByTestId('finished-games-toggle')).toHaveTextContent('Finished games (1)');
  const user = userEvent.setup();
  await user.click(screen.getByTestId('finished-games-toggle'));
  expect(screen.getByTestId('finished-game-g2')).toHaveTextContent('Old War');
});

test('no finished-games expander when nothing is finished', async () => {
  vi.mocked(api.gameList).mockResolvedValue({
    games: [{ id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' }],
  });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  await screen.findByText('Office War');
  expect(screen.queryByTestId('finished-games-toggle')).not.toBeInTheDocument();
});

test('host can delete a finished test game from inside the expander', async () => {
  vi.mocked(api.gameList).mockResolvedValue({
    games: [{ id: 'g3', name: 'Done Test', mode: 'test', status: 'finished', playerCount: 4, created_at: '', createdBy: 'p1' }],
  });
  vi.mocked(api.gameDelete).mockResolvedValue({ ok: true });
  vi.stubGlobal('confirm', () => true);
  const user = userEvent.setup();
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  await screen.findByText('Finished games (1)');
  await user.click(screen.getByTestId('finished-games-toggle'));
  await user.click(screen.getByRole('button', { name: /^delete/i }));
  expect(api.gameDelete).toHaveBeenCalledWith('tok-1', 'g3');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace app -- src/pages/Dashboard.test.tsx`
Expected: FAIL — no `finished-games-toggle` testid; "Old War" currently renders in the main list.

- [ ] **Step 3: Implement**

In `Dashboard.tsx`, above the return, split the list:
```tsx
const activeGames = games?.filter((g) => g.status === 'lobby' || g.status === 'active') ?? null;
const finishedGames = games?.filter((g) => g.status !== 'lobby' && g.status !== 'active') ?? null;
```
Adjust the empty-state: "No games yet…" shows when `activeGames?.length === 0 && !finishedGames?.length`. Render `activeGames` in the existing `<ul>`. After it, inside the same card:
```tsx
{finishedGames && finishedGames.length > 0 && (
  <details className="finished-games">
    <summary data-testid="finished-games-toggle">Finished games ({finishedGames.length})</summary>
    <ul className="game-list">
      {finishedGames.map((g) => (
        <li key={g.id} className="game-row" data-testid={`finished-game-${g.id}`}>
          {/* same game-link + conditional delete row as the active list */}
        </li>
      ))}
    </ul>
  </details>
)}
```
Extract the row into a small local component (e.g. `GameRow({ g })`) so the active list and expander share it — the delete-button rule (`g.createdBy === player?.id && (g.mode === 'test' || g.status === 'lobby')`) is applied identically in both.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/pages/Dashboard.test.tsx`
Expected: PASS — all existing Dashboard tests still green (their lists are lobby/active only).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Dashboard.tsx app/src/pages/Dashboard.test.tsx
git commit -m "feat(app): finished games collapse into an expander on the games page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: AP timer stops on finished games

**Files:**
- Modify: `app/src/pages/Game.tsx` (LocalGameView timer + drip, DbGameView timer + effect)
- Test: `app/src/pages/Game.test.tsx`

**Interfaces:**
- Consumes: `state.winner` (GameState), `detail.status` ('finished').
- Produces: both views hide the timer element and stop the countdown when finished; LocalGameView also stops the drip via `game.stopApDrip()` (the engine's `daily_tick` bypasses the winner guard, so the drip must be stopped, not caught). Gating condition: `!!state?.winner || detail?.status === 'finished'`.

- [ ] **Step 1: Write the failing tests**

```tsx
test('won game: no AP timer', () => {
  setup({ state: { ...STATE, winner: 'p1' } });
  expect(screen.queryByTestId('ap-timer')).not.toBeInTheDocument();
});

test('server-finished game (no winner in state yet): no AP timer', () => {
  setup({ detail: { id: 'g1', name: 'g', mode: 'test', status: 'finished', config: STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null } });
  expect(screen.queryByTestId('ap-timer')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace app -- src/pages/Game.test.tsx`
Expected: FAIL — `ap-timer` still renders in both cases (the countdown effect also keeps running).

- [ ] **Step 3: Implement**

DbGameView:
```tsx
const gameFinished = !!state?.winner || detail?.status === 'finished';
```
- Countdown effect (`Game.tsx:301`): first lines `if (gameFinished) { setApRemaining(null); return; }`; add `gameFinished` to deps.
- Timer render (`Game.tsx:387`): `{!gameFinished && apRemaining != null && (…)}`
LocalGameView:
- Timer render (`Game.tsx:134`): `{!state.winner && (<span className="timer" data-testid="ap-timer">…)}`
- Countdown effect (`Game.tsx:73`): early `return` when `state.winner` (add to deps).
- New effect: `useEffect(() => { if (state.winner) game.stopApDrip(); }, [state.winner, game]);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/pages/Game.test.tsx`
Expected: PASS, including the pre-existing 'AP countdown keeps ticking through history scrubbing' test (active game, timer present).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Game.tsx app/src/pages/Game.test.tsx
git commit -m "fix(app): AP timer stops on won/finished games; local drip halts on winner

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Server guest join gate

**Files:**
- Modify: `supabase/functions/_shared/auth.ts` (AuthedPlayer, verifyGoTrueJwt, getPlayer)
- Modify: `supabase/functions/game-join/index.ts` (gate, after line 22)
- Test: live smoke only (Task 11) — the functions have no unit harness for auth (getPlayer needs a real GoTrue token + DB); the one-line gate is deployed and smoke-verified. `deno check` gates types.

**Interfaces:**
- Consumes: the GoTrue JWT payload's `is_anonymous` claim (true for `signInAnonymously` sessions).
- Produces: `AuthedPlayer { id: string; name: string; isAnonymous: boolean }`; `verifyGoTrueJwt(token)` returns `{ sub: string; isAnonymous: boolean } | null` (sole caller is `getPlayer` — grep confirmed). game-join rejects guests with 403 `{ error: 'register to join shared games' }` before any membership write. Only `game-join` gates — `game-list`, `game-get`, `action` must NOT (guests already in games keep working).

- [ ] **Step 1: Typecheck first (baseline)**

Run: `deno check supabase/functions/game-join/index.ts`
Expected: clean. (No unit test possible; the return-type change ripples only to `getPlayer` — if `deno check` shows another caller, adapt it.)

- [ ] **Step 2: Implement**

`auth.ts`:
- `export interface AuthedPlayer { id: string; name: string; isAnonymous: boolean }`
- `verifyGoTrueJwt` returns `Promise<{ sub: string; isAnonymous: boolean } | null>`; both the HS256 and ES256 success paths return `{ sub: payload.sub, isAnonymous: payload.is_anonymous === true }` (add `is_anonymous?: boolean` to the payload type).
- `getPlayer` uses the returned object: `return data ? { id: sub, name: data.name, isAnonymous } : null` shape.

`game-join/index.ts`, immediately after the test-mode rejection (line 22):
```ts
// guests (anonymous sign-ins) must not enter shared invite-code games
if (me.isAnonymous) return json({ error: 'register to join shared games' }, 403);
```

- [ ] **Step 3: Typecheck**

Run: `deno check supabase/functions/game-join/index.ts supabase/functions/game-get/index.ts supabase/functions/action/index.ts`
Expected: clean (game-get/action still call `getPlayer` and only read `id`/`name` — no breakage).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/game-join/index.ts
git commit -m "feat(functions): guests cannot join invite-code games (403 gate in game-join)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Client guest gate

**Files:**
- Modify: `app/src/pages/Dashboard.tsx` (Join card + `?join=` effect)
- Modify: `app/src/pages/Play.tsx` (guest branch)
- Test: `app/src/pages/Dashboard.test.tsx`, `app/src/pages/Play.test.tsx`

**Interfaces:**
- Consumes: `useAuth().isGuest` (already exposed — Dashboard.tsx:8 uses it).
- Produces: guests never call `gameJoin` from the UI. Dashboard: Join card replaced by the pinned copy + Register link; `?join=CODE` deep-link navigates guests to `/auth` (replace) instead of joining. Play: a guest sees the pinned copy + Register link and no join attempt.

- [ ] **Step 1: Write the failing tests**

In `Dashboard.test.tsx`:
```tsx
test('guests see no join form, just a register hint', async () => {
  vi.mocked(api.gameList).mockResolvedValue({ games: [] });
  vi.mocked(useAuth).mockReturnValue({ player: { id: 'p9', name: 'guest-abc' }, token: 'tok-1', isGuest: true, signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn() } as never);
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  await screen.findByRole('heading', { name: /games/i });
  expect(screen.queryByLabelText(/invite code/i)).not.toBeInTheDocument();
  expect(screen.getByText(/can't join shared games/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /register/i })).toHaveAttribute('href', '/auth');
});

test('guest opening ?join=CODE is sent to register, join never attempted', async () => {
  vi.mocked(useAuth).mockReturnValue({ player: { id: 'p9', name: 'guest-abc' }, token: 'tok-1', isGuest: true, signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn() } as never);
  render(
    <MemoryRouter initialEntries={['/dashboard?join=CODE123']}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/auth" element={<div>AUTH PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('AUTH PAGE');
  expect(api.gameJoin).not.toHaveBeenCalled();
});
```
In `Play.test.tsx` (adapt to its existing mock harness for `useAuth`/api):
```tsx
test('guest sees the register prompt instead of joining', async () => {
  // mock useAuth → isGuest: true, token present
  render(<Play />);
  expect(screen.getByText(/can't join shared games/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /register/i })).toHaveAttribute('href', '/auth');
  expect(api.gameJoin).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace app -- src/pages/Dashboard.test.tsx src/pages/Play.test.tsx`
Expected: FAIL — join form still renders for guests; `gameJoin` gets called with the deep-link code.

- [ ] **Step 3: Implement**

Dashboard.tsx:
- In the `?join=` effect (line 37): first line `if (isGuest) { navigate('/auth', { replace: true }); return; }` (add `isGuest` to deps).
- Join card: when `isGuest`, render instead of the form:
```tsx
<p className="muted">Guests can't join shared games — <Link to="/auth">register</Link> first.</p>
```
Play.tsx:
- `const { token, isGuest } = useAuth();` — before the auto-join effect produces a join: if `isGuest`, render
```tsx
<main className="page">
  <p>Guests can't join shared games — <Link to="/auth">register</Link> first.</p>
</main>
```
and skip the effect body entirely (`if (!token || isGuest || started.current) return;`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/pages/Dashboard.test.tsx src/pages/Play.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Dashboard.tsx app/src/pages/Play.tsx app/src/pages/Dashboard.test.tsx app/src/pages/Play.test.tsx
git commit -m "feat(app): guests are routed to register instead of joining shared games

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Cumulative fork cuts in canonicalHistory (server)

**Files:**
- Modify: `supabase/functions/_shared/history.ts:24-33` (`canonicalHistory`)
- Test: `supabase/functions/_shared/history_test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `canonicalHistory(rows, forks)` where generation G's cut is `min(to_seq of every fork with parent_generation >= G)`. After this fix, canonical history NEVER contains duplicate seqs, even when a later rewind targets a seq from an earlier generation (the root cause of the "View shows a different board" bug and of `fork state rebuild failed` 500s). Consumers (`rebuildStateAt`, game-get, action) unchanged.

- [ ] **Step 1: Write the failing test**

Append to `history_test.ts` (reuse the file's `row`/`fork` helpers):
```ts
Deno.test('canonicalHistory: a rewind below an earlier fork cut truncates every earlier generation (no duplicate seqs)', () => {
  // gen1 ran 1..5; fork@5 → gen2 ran 6..8; then a rewind to seq 3 (a GEN-1
  // event) → gen3 continues at 4. Cumulative cuts: gen1 must end at 3, so
  // canonical history is 1,2,3 then gen3's 4,5 — seqs 4,5 must not appear twice.
  const rows = [
    row(1, 1, 'g1'), row(2, 1, 'g1'), row(3, 1, 'g1-cut'),
    row(4, 1, 'DISCARDED'), row(5, 1, 'DISCARDED'),
    row(6, 2, 'g2'), row(7, 2, 'g2'), row(8, 2, 'DISCARDED'),
    row(4, 3, 'g3'), row(5, 3, 'g3'),
  ];
  const out = canonicalHistory(rows, [fork(1, 5), fork(2, 3)]);
  const seqs = out.map((r) => r.seq);
  assertEquals(new Set(seqs).size, seqs.length);
  assertEquals(seqs, [1, 2, 3, 4, 5]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/history_test.ts`
Expected: FAIL — the new test's seqs come back `[1,2,3,4,5,4,5]` (duplicates).

- [ ] **Step 3: Implement**

In `canonicalHistory`, after the existing per-parent `cutByGen` map is built, propagate a suffix minimum:
```ts
// A later fork that rewinds BELOW an earlier fork's cut also truncates
// every EARLIER generation (the timeline flows through them). Propagate
// the minimum cut backwards so canonical history never emits duplicate
// seqs across generations.
const gens = [...cutByGen.keys()].sort((a, b) => a - b);
let running = Infinity;
for (let i = gens.length - 1; i >= 0; i--) {
  running = Math.min(running, cutByGen.get(gens[i])!);
  cutByGen.set(gens[i], running);
}
```

- [ ] **Step 4: Run the whole file to verify green**

Run: `deno test --allow-all supabase/functions/_shared/history_test.ts`
Expected: PASS — including the chained-fork and single-fork regressions (unchanged behavior when a later fork's to_seq is above an earlier cut).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/history.ts supabase/functions/_shared/history_test.ts
git commit -m "fix(functions): cumulative fork cuts — rewinds below an earlier cut no longer duplicate seqs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Index-based scrubbing (client)

**Files:**
- Modify: `app/src/components/EventFeed.tsx` (props + internals)
- Modify: `app/src/pages/Game.tsx` (both views: `viewEvent`, `activeIndex`, `onFork`)
- Modify: `app/src/pages/Jury.tsx:72` (prop rename)
- Test: `app/src/components/EventFeed.test.tsx`, `app/src/pages/Game.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (replaces the seq-based contract): `EventFeedProps { entries: FeedEntry[]; activeIndex: number | null; live: boolean; replaying: boolean; onView?: (index: number) => void; onReplay?: () => void; onStop?: () => void; onFork?: (index: number) => void; canFork?: boolean }`. `index` is the row's index in `entries` (0-based, chronological — NOT the reversed display order). Row `key` = index. `active` class on `i === activeIndex`; `future` on `live === false && activeIndex !== null && i > activeIndex`. Game.tsx: `viewEvent(idx)` sets `scrubIdx = idx + 1` directly (no findIndex); `activeIndex = scrubIdx === null ? null : Math.min(scrubIdx, history.length) - 1`; `onFork={(idx) => { const seq = history[idx]?.seq; if (seq !== undefined) void forkTo(seq); }}`.

- [ ] **Step 1: Write the failing tests**

`Game.test.tsx` — the regression test (duplicate seqs, the legacy corrupted shape):
```tsx
test('View addresses rows by INDEX: with duplicate seqs the clicked (newer) row is highlighted, not its older twin', () => {
  setup({
    history: [
      { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
      { seq: 2, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 4, y: 4 } }, generation: 1 },
      { seq: 3, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 2, y: 0 } }, generation: 1 },
      { seq: 3, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 5, y: 5 } }, generation: 2 },
    ],
  });
  const views = screen.getAllByRole('button', { name: /view state after event 3/i });
  expect(views.length).toBe(2);
  fireEvent.click(views[1]); // the NEWER duplicate (gen 2, index 3)
  // Visible order is newest-first: i=3, i=2, i=1, i=0. activeIndex is 3, so
  // items[0] is active; NOTHING is 'future' (no index > 3); the older
  // seq-3 twin (items[1], i=2) must NOT be active.
  const items = screen.getAllByRole('listitem');
  expect(items[0].className).toContain('active');
  expect(items[1].className).not.toContain('active');
  expect(items[1].className).not.toContain('future');
  expect(items[2].className).not.toContain('active');
  expect(items[3].className).not.toContain('active');
});
```
This test fails against the old seq-based code: both seq-3 rows compare `e.seq === activeSeq` true, so items[0] AND items[1] would both be `active`.
Update the existing View test (Game.test.tsx:179) — its aria-labels/`active` class assertions stay valid since single-generation histories are unaffected; if any assertion referenced `activeSeq` naming, update mechanically.
`EventFeed.test.tsx`: update the harness to the new props (`activeIndex: number | null`, `onView: (i: number) => void`); existing behavioral assertions (highlight, dimming, toolbar) keep their meaning with indices instead of seqs.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace app -- src/pages/Game.test.tsx src/components/EventFeed.test.tsx`
Expected: FAIL — with duplicate seqs, BOTH seq-3 rows light up `active` (old code compares `e.seq === activeSeq`); TypeScript also errors on the renamed props.

- [ ] **Step 3: Implement**

`EventFeed.tsx`:
- Props per the Produces block; rename `activeSeq` → `activeIndex` throughout.
- Rows: `const visible = entries.map((e, i) => ({ e, i })).reverse();` — key, class comparison, `onView(i)`, `onFork(i)` all use `row.i`; replay progress shows `activeIndex + 1`.
`Game.tsx` (both views):
- `viewEvent = (idx: number) => { setReplaying(false); setMode('none'); setScrubIdx(idx + 1); };` (delete the findIndex).
- `activeIndex={scrubIdx === null ? null : Math.min(scrubIdx, history.length) - 1}` (or `game.history` in LocalGameView).
- `onFork={(idx) => { const seq = history[idx]?.seq; if (seq !== undefined) void forkTo(seq); }}`.
`Jury.tsx:72`: `activeSeq={null}` → `activeIndex={null}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/pages/Game.test.tsx src/components/EventFeed.test.tsx src/pages/Jury.test.tsx`
Expected: PASS — the regression test highlights exactly the clicked row.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/EventFeed.tsx app/src/components/EventFeed.test.tsx app/src/pages/Game.tsx app/src/pages/Game.test.tsx app/src/pages/Jury.tsx
git commit -m "fix(app): history View/Fork address rows by index — duplicate seqs can no longer show the wrong board

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Board tank overlay — slide animation, dead tanks hidden

**Files:**
- Modify: `app/src/components/Board.tsx` (restructure cell loop + tank layer)
- Modify: `app/src/styles.css` (`.tank` transition)
- Test: `app/src/components/Board.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: Board renders cells (rect + tap only), then an overlay tank layer — one `<g key={playerId}>` per ALIVE player (`hp > 0`), positioned by `style={{ transform: translate(x*CELL, y*CELL) }}` with `data-testid="tank-<id>"`, containing the image (at 0,0), ring, and life bar (lifeBar now takes relative coords 0,0). `legal()`/`occupantAt` logic UNCHANGED (dead tanks still block moves — visual only). CSS: `.tank { transition: transform 300ms ease; }`. Dead tanks are NOT rendered. Board props unchanged in this task.

- [ ] **Step 1: Write the failing tests**

```tsx
test('tank element PERSISTS across a move and its transform updates (slide, not remount)', () => {
  const { container, rerender } = render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
  const before = container.querySelector('[data-testid="tank-p1"]')!;
  rerender(<Board state={state({ players: { ...state().players, p1: { ...state().players.p1, pos: { x: 1, y: 0 } } } })} selectedMode="none" me="p1" onCellTap={() => {}} />);
  const after = container.querySelector('[data-testid="tank-p1"]')!;
  expect(after).toBe(before); // same DOM node — CSS transition can animate it
  expect(after.getAttribute('style')).toContain('translate(40px');
});

test('dead tanks are not rendered (visual only — cells still behave)', () => {
  const dead = state({ players: { ...state().players, p2: { ...state().players.p2, hp: 0 } } });
  render(<Board state={dead} selectedMode="none" me="p1" onCellTap={() => {}} />);
  expect(screen.queryByTestId('tank-p2')).not.toBeInTheDocument();
  expect(screen.getByTestId('tank-p1')).toBeInTheDocument();
});

test('tank transform reflects its position', () => {
  render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
  expect(screen.getByTestId('tank-p1').getAttribute('style')).toContain('translate(0px, 0px)');
  expect(screen.getByTestId('tank-p2').getAttribute('style')).toContain('translate(80px, 0px)');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace app -- src/components/Board.test.tsx`
Expected: FAIL — tanks have no style transform (positioned via x/y attributes); dead tanks currently render.

- [ ] **Step 3: Implement**

`Board.tsx`:
- Cell loop: render ONLY the `<rect>` (drop `occId`/`occ` and the nested tank from the loop).
- After the loop, inside the same `<svg>`, the tank layer:
```tsx
{Object.values(state.players).filter((p) => p.hp > 0).map((p) => (
  <g key={p.id} data-testid={`tank-${p.id}`} className={p.id === me ? 'own' : 'enemy'}
     style={{ transform: `translate(${p.pos.x * CELL}px, ${p.pos.y * CELL}px)` }}
     onClick={() => onCellTap(p.pos)}>
    <image x={0} y={0} width={CELL} height={CELL} href={avatars?.[p.id] ?? flagUrl(p.id)}
           preserveAspectRatio="xMidYMid slice" className="tank-image" data-testid={`tank-image-${p.id}`} />
    <rect x={0} y={0} width={CELL} height={CELL} fill="none"
          stroke={p.id === me ? 'var(--signal)' : 'var(--olive)'} strokeWidth="3" pointer-events="none" />
    {lifeBar(p, 0, 0, state.config.startingHp)}
  </g>
))}
```
- `lifeBar` keeps its signature; callers now pass relative `0, 0` (the `<g>` carries the translation).
`styles.css`: add `.tank { transition: transform 300ms ease; }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/components/Board.test.tsx`
Expected: PASS — including the existing tests (avatar, HP-bar geometry, range/legal overlays, onCellTap). If `tank-image` position assertions exist they hold (coordinates are relative to the translated `<g>`).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/Board.tsx app/src/components/Board.test.tsx app/src/styles.css
git commit -m "feat(app): tanks are a keyed overlay layer — moves slide, dead tanks hidden

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Event effects — red bullet, green bullet, pulse; replay wiring

**Files:**
- Modify: `app/src/components/Board.tsx` (new `lastEvent` prop + fx layer)
- Modify: `app/src/styles.css` (fx keyframes)
- Modify: `app/src/pages/Game.tsx` (both views pass `lastEvent`)
- Test: `app/src/components/Board.test.tsx`, `app/src/pages/Game.test.tsx`

**Interfaces:**
- Consumes: Task 9's tank layer; `GameEvent` from `@ttt/engine`.
- Produces: `BoardProps.lastEvent?: GameEvent | null` — the newest applied event, or (while scrubbing/replaying) the event at the scrub position. Board derives, keyed by `lastEvent.seq`:
  - `attack` → `fx-attack`: red dot (`circle r=5 fill=#e33`) translating from actor cell center to target cell center over 250ms (inline CSS custom props `--fx-dx/--fx-dy` + a fixed keyframe), plus a victim flash ring at the target.
  - `give_ap` → `fx-give_ap`: same geometry, green `#3c3`.
  - `upgrade_range` → `fx-pulse`: expanding dashed circle centered on the actor.
  - other types (`move`, `daily_tick`, …) → no fx element.
  fx hides on `animationend` and re-shows when `lastEvent.seq` changes. If actor/target positions are missing from state, no fx renders.

- [ ] **Step 1: Write the failing tests**

In `Board.test.tsx` (build events against the file's `state()` helper):
```tsx
const attackEvent = (targetHp = 3) => ({
  seq: 1, type: 'attack' as const, actorId: 'p1', createdAt: 't',
  payload: { targetId: 'p2' },
});

test('attack event spawns a red bullet fx (even at a now-dead target)', () => {
  render(<Board state={state({ players: { ...state().players, p2: { ...state().players.p2, hp: 0 } } })}
                selectedMode="none" me="p1" onCellTap={() => {}} lastEvent={attackEvent(0)} />);
  const fx = screen.getByTestId('fx-attack');
  expect(fx.querySelector('circle')).not.toBeNull();
  expect(fx.querySelector('circle')!.getAttribute('fill')).toBe('#e33');
});

test('give_ap event spawns a green bullet fx', () => {
  render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
    lastEvent={{ seq: 2, type: 'give_ap', actorId: 'p1', createdAt: 't', payload: { targetId: 'p2', amount: 1 } }} />);
  expect(screen.getByTestId('fx-give_ap').querySelector('circle')!.getAttribute('fill')).toBe('#3c3');
});

test('upgrade_range event spawns a pulse ring on the actor', () => {
  render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
    lastEvent={{ seq: 3, type: 'upgrade_range', actorId: 'p1', createdAt: 't', payload: {} }} />);
  expect(screen.getByTestId('fx-pulse')).toBeInTheDocument();
});

test('move events spawn no fx; fx is removed on animationend', () => {
  const { rerender } = render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
    lastEvent={{ seq: 4, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } } }} />);
  expect(screen.queryByTestId('fx-move')).not.toBeInTheDocument();
  rerender(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} lastEvent={attackEvent()} />);
  fireEvent.animationEnd(screen.getByTestId('fx-attack'));
  expect(screen.queryByTestId('fx-attack')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace app -- src/components/Board.test.tsx`
Expected: FAIL — no `lastEvent` prop, no fx elements (TS error on unknown prop).

- [ ] **Step 3: Implement**

`Board.tsx`:
- Props: `lastEvent?: GameEvent | null` (import the type from `@ttt/engine`).
- Local state `const [fxLive, setFxLive] = useState(true)`; `useEffect(() => setFxLive(true), [lastEvent?.seq]);`
- Derive the fx target (inside the component):
```ts
let fx: { kind: 'attack' | 'give_ap' | 'upgrade_range'; from: Vec; to: Vec | null } | null = null;
if (lastEvent && fxLive) {
  const actor = state.players[lastEvent.actorId];
  if (actor && (lastEvent.type === 'attack' || lastEvent.type === 'give_ap')) {
    const target = state.players[(lastEvent.payload as { targetId?: string }).targetId ?? ''];
    if (target) fx = { kind: lastEvent.type, from: actor.pos, to: target.pos };
  } else if (actor && lastEvent.type === 'upgrade_range') {
    fx = { kind: 'upgrade_range', from: actor.pos, to: null };
  }
}
```
- fx layer after the tank layer, `key={lastEvent!.seq}`, `data-testid={`fx-${fx.kind}`}`, `onAnimationEnd={() => setFxLive(false)}`:
  - attack / give_ap: outer `<g style={{ transform: `translate(${fx.from.x * CELL + CELL / 2}px, ${fx.from.y * CELL + CELL / 2}px)` }}>` containing `<circle r={5} fill={fx.kind === 'attack' ? '#e33' : '#3c3'} className="fx-bullet" style={{ ['--fx-dx' as string]: `${(fx.to!.x - fx.from.x) * CELL}px`, ['--fx-dy' as string]: `${(fx.to!.y - fx.from.y) * CELL}px` }} />` plus a victim flash `<circle cx={fx.to!.x * CELL + CELL / 2} cy={fx.to!.y * CELL + CELL / 2} r={CELL / 2} className="fx-victim" />` (outside the translated g).
  - upgrade_range: `<circle cx={fx.from.x * CELL + CELL / 2} cy={fx.from.y * CELL + CELL / 2} r={CELL * 1.5} className="fx-pulse" />`.
`styles.css`:
```css
.fx-bullet { animation: ttt-bullet 250ms ease-in forwards; }
@keyframes ttt-bullet { from { transform: translate(0, 0); } to { transform: translate(var(--fx-dx), var(--fx-dy)); } }
.fx-victim { fill: none; stroke: #e33; animation: ttt-flash 400ms ease-out forwards; }
@keyframes ttt-flash { from { opacity: .9; } to { opacity: 0; } }
.fx-pulse { fill: none; stroke: var(--signal); stroke-dasharray: 6 4; animation: ttt-pulse 600ms ease-out forwards; transform-box: fill-box; transform-origin: center; }
@keyframes ttt-pulse { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
```
`Game.tsx` (both views, above the `<Board>` render):
```tsx
const lastEvent = scrubIdx !== null
  ? history[Math.min(scrubIdx, history.length) - 1] ?? null   // game.history in LocalGameView
  : history[history.length - 1] ?? null;
```
pass `lastEvent={lastEvent}` to `<Board>`. Replay (item 8) needs no extra code — the 1/sec scrub stepper already changes `scrubIdx`, so `lastEvent` advances one event per step.
`Game.test.tsx`: extend the Board mock (Game.test.tsx:17) to also destructure `lastEvent` and render `<div data-testid="board" data-last-event={lastEvent?.type ?? ''}>…`; add:
```tsx
test('replay/scrub feeds the stepped event to Board as lastEvent', () => {
  setup({
    history: [
      { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
      { seq: 2, type: 'attack', actorId: 'p2', createdAt: 't', payload: { targetId: 'p1' }, generation: 1 },
    ],
  });
  fireEvent.click(screen.getAllByRole('button', { name: /view state after event 2/i })[0]);
  expect(screen.getByTestId('board')).toHaveAttribute('data-last-event', 'attack');
  fireEvent.click(screen.getByTestId('back-to-live'));
  expect(screen.getByTestId('board')).toHaveAttribute('data-last-event', 'attack'); // newest event
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace app -- src/components/Board.test.tsx src/pages/Game.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/Board.tsx app/src/components/Board.test.tsx app/src/styles.css app/src/pages/Game.tsx app/src/pages/Game.test.tsx
git commit -m "feat(app): board event fx — move slides, attack red bullet, give green, upgrade pulse; replay animates

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: Deploy edge functions + live smoke

**Files:** none (ops + verification).

**Interfaces:**
- Consumes: Tasks 5–7's server changes merged to main; Supabase PAT from memory (`supabase-pat.md`), project ref `sifbpmpxyiycbupntobl`.
- Produces: deployed `game-get`, `action`, `game-join`; GitHub Pages redeploy of the app (automatic on push to main).

- [ ] **Step 1: Full suite green before deploy**

Run: `npm test` (root — both workspaces) and `deno test --allow-all supabase/functions/_shared/history_test.ts`
Expected: all PASS.

- [ ] **Step 2: Deploy the three functions**

```bash
export SUPABASE_ACCESS_TOKEN=<PAT from memory supabase-pat.md>
supabase functions deploy game-get --project-ref sifbpmpxyiycbupntobl
supabase functions deploy action --project-ref sifbpmpxyiycbupntobl
supabase functions deploy game-join --project-ref sifbpmpxyiycbupntobl
```
Expected: each deploy succeeds. (`--no-verify-jwt` is NOT needed for these three — that flag is tick-specific.)

- [ ] **Step 3: Live smoke on the prod site (Playwright MCP)**

Against `https://lizzard1123.github.io/tank-turn-tactics/`:
1. Signed-out → register a throwaway account → Games page renders; create a test game with a bot; start it; make a move → the tank SLIDES to the new cell; attack → red bullet fx; give AP → green bullet fx.
2. Replay from the feed → the board animates one event per step (slides/bullets visible per step).
3. Finished-games expander: any finished game appears under `Finished games (n)`, hidden until toggled.
4. AP timer: finish a test game (or view one already finished) → no `ap-timer` element; winner banner shows.
5. Guest gate: enter Test Mode (guest session) → back on Games page the Join form is replaced by the register hint; hitting Play with a guest shows the register prompt; the server rejects a raw guest `game-join` with `register to join shared games`.
6. Scrubber: fork a test game, then rewind to before the first fork's cut → View an event → the board matches THAT event (no duplicate-seq corruption).
Clean up: hard-delete any scratch prod games via psql (established cleanup precedent).

- [ ] **Step 4: Report**

Report smoke outcomes verbatim; any failure goes back through systematic-debugging with the failing step named.
