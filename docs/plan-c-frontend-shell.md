# Plan C — Frontend Shell (Landing, Auth, Lobby) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deployable app skeleton: landing page with Play / Instructions /
Test Mode, name+password auth, dashboard (game list + join), and the game
config lobby with full test-mode knobs. No board gameplay yet (Plan D).

**Architecture:** Vite + React + TS SPA, `react-router-dom`. Auth session in
localStorage via a context. All backend access through `lib/api.ts` (typed
Edge Function calls). Test Mode uses a real registration under the hood
(auto-generated name `guest-xxxx` + random password, stored in localStorage)
so all security paths are identical to production.

**Tech Stack:** Vite, React 18, react-router-dom, @supabase/supabase-js (for
realtime in Plan D), plain CSS (single stylesheet, CSS variables, mobile-first).

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`
**Overview:** `docs/plans-overview.md`

## Global Constraints

- Mobile-first: works at 400px; touch targets ≥ 44px.
- GitHub Pages base path: `base: '/tank-turn-tactics/'` in vite.config, and
  router basename to match (set from `import.meta.env.BASE_URL`).
- No UI framework; one `src/styles.css` with CSS custom properties.
- All game state rendering in Plan D; this plan only builds navigation,
  auth, forms, and the lobby.

---

### Task C1: App scaffold + landing page

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/index.html`,
  `app/tsconfig.json`
- Create: `app/src/main.tsx`, `app/src/App.tsx`, `app/src/pages/Landing.tsx`
- Create: `app/src/styles.css`
- Test: `app/src/pages/Landing.test.tsx`

**Interfaces:**
- Produces: routes `/`, `/instructions`, `/auth`, `/dashboard`, `/lobby/:gameId`,
  `/test`. `Landing.tsx` exports default page with three buttons that
  navigate (data-testid: `btn-play`, `btn-instructions`, `btn-test`).

- [ ] **Step 1: Scaffold**

```bash
cd app && npm create vite@latest . -- --template react-ts
npm i react-router-dom
```

Adjust `package.json` name to `@ttt/app`; add `"test": "vitest run"`; add
`@testing-library/react @testing-library/user-event jsdom` as devDeps;
vitest config in `vite.config.ts` (`test: { environment: 'jsdom' }`).

- [ ] **Step 2: vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/tank-turn-tactics/',
  plugins: [react()],
  test: { environment: 'jsdom' },
});
```

- [ ] **Step 3: App.tsx + Landing with failing test**

```tsx
// App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <BrowserRouter basename={base}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

```tsx
// Landing.tsx
import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <main className="landing">
      <h1>Tank Turn Tactics</h1>
      <p className="tagline">Alliances. Betrayal. Last tank standing.</p>
      <nav className="menu">
        <Link className="menu-item" data-testid="btn-play" to="/auth">Play</Link>
        <Link className="menu-item" data-testid="btn-instructions" to="/instructions">Instructions</Link>
        <Link className="menu-item" data-testid="btn-test" to="/test">Test Mode</Link>
      </nav>
    </main>
  );
}
```

```tsx
// Landing.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';

test('renders three menu items', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByTestId('btn-play')).toHaveTextContent('Play');
  expect(screen.getByTestId('btn-instructions')).toHaveTextContent('Instructions');
  expect(screen.getByTestId('btn-test')).toHaveTextContent('Test Mode');
});
```

- [ ] **Step 4: styles.css** — mobile-first landing: full-viewport centered
  column, `.menu-item` stacked full-width buttons, min-height 48px, system
  font stack. Dark-friendly defaults via CSS variables
  (`--bg`, `--fg`, `--accent`).
- [ ] **Step 5: Run** `npm test` → PASS; `npm run dev` → visually verify.
- [ ] **Step 6: Commit** `feat(app): scaffold + landing`.

---

### Task C2: Instructions page

**Files:**
- Create: `app/src/pages/Instructions.tsx`
- Test: `app/src/pages/Instructions.test.tsx`

**Interfaces:**
- Consumes: none.
- Produces: route `/instructions`; static content sections: Goal, Stats
  (HP/AP/Range), Actions (Move/Attack/Give AP/Upgrade Range with AP costs),
  The Jury, The Day Cycle, Winning. Copy from the spec's rules section.

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Instructions from './Instructions';

test('shows rules sections and back link', () => {
  render(<MemoryRouter><Instructions /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: /stats/i })).toBeInTheDocument();
  expect(screen.getByText(/move/i)).toBeInTheDocument();
  expect(screen.getByText(/jury/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** page (content per spec,
  `<Link to="/">Back</Link>`). **Step 4: Run → PASS.** **Step 5: Commit**
  `feat(app): instructions page`.

---

### Task C3: Auth (register + sign-in) + session context

**Files:**
- Create: `app/src/lib/supabase.ts` (placeholder client config in D),
  `app/src/lib/api.ts`, `app/src/lib/auth.tsx`, `app/src/pages/Auth.tsx`
- Modify: `app/src/App.tsx` (add routes + auth gate)
- Test: `app/src/lib/auth.test.tsx`, `app/src/pages/Auth.test.tsx`

**Interfaces:**
- Produces:
  - `api.ts`: `register(name, password): Promise<{token, player}>`,
    `signin(name, password): Promise<{token, player}>` — POST to
    `${SUPABASE_URL}/functions/v1/{register,signin}` with anon key header.
  - `auth.tsx`: `AuthProvider` + `useAuth(): {player, token, signin, register,
    signout, guestSignin}` — persists to `localStorage` keys `ttt_token`,
    `ttt_player`.
  - `Auth.tsx`: one form, tabs "Sign in" / "Create account", fields
    name/password, error display; navigates to `/dashboard` on success.
  - `RequireAuth` wrapper (redirects to `/auth` when no player).

- [ ] **Step 1: Failing tests** — auth context stores token after mocked
  `register`; Auth page validates password ≥ 8 client-side and shows API
  error text.

```tsx
// auth.test.tsx (key case)
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth';
import * as api from './api';

vi.mock('./api', () => ({ register: vi.fn(), signin: vi.fn() }));

test('register stores session', async () => {
  vi.mocked(api.register).mockResolvedValue({ token: 't1', player: { id: 'p1', name: 'a' } });
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(() => result.current.register('a', 'longenough'));
  expect(localStorage.getItem('ttt_token')).toBe('t1');
  expect(result.current.player?.name).toBe('a');
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** `api.ts`, `auth.tsx`,
  `Auth.tsx`; add routes `/auth` (public) and `/dashboard` (wrapped in
  `RequireAuth`) plus `/test` route placeholder. **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): auth + session context`.

---

### Task C4: Test-mode guest session

**Files:**
- Modify: `app/src/lib/auth.tsx`, `app/src/pages/Landing.tsx`
- Test: `app/src/lib/auth.test.tsx` (extend)

**Interfaces:**
- Produces: `guestSignin(): Promise<void>` — checks localStorage for an
  existing guest session (`ttt_guest` flag + token); if none, registers
  `guest-<6 random chars>` with a random 16-char password, marks
  `isGuest: true` in context; navigates onward. Play still requires a real
  account (guests clicking Play get told to create an account).

- [ ] **Step 1: Failing test** — `guestSignin` creates session once; second
  call reuses it (api.register called exactly once across two calls).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): test-mode guest session`.

---

### Task C5: Dashboard (game list, create, join)

**Files:**
- Create: `app/src/pages/Dashboard.tsx`
- Modify: `app/src/lib/api.ts` (add `gameList`, `gameCreate`, `gameJoin`,
  `gameGet`), `app/src/App.tsx` (route `/game/:gameId` placeholder)
- Test: `app/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: B5 endpoints (as functions): `gameList(): Promise<GameSummary[]>`,
  `gameCreate(input): Promise<{gameId, inviteCode}>`,
  `gameJoin(inviteCode): Promise<{gameId}>`, `gameGet(id): Promise<GameDetail>`.
- Produces: Dashboard shows: "Your games" list (status chips: lobby/active/
  finished, tap → `/game/:id`), "Join with invite code" input + button,
  "Create game" form: name, mode (play/test), and for play mode: board size,
  AP per day, daily time, starting HP/AP; navigates to `/lobby/:gameId`.

- [ ] **Step 1: Failing tests** — renders mocked list; create form submits
  correct payload; join navigates.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): dashboard`.

---

### Task C6: Lobby / config screen (full knobs in test mode)

**Files:**
- Create: `app/src/pages/Lobby.tsx`
- Modify: `app/src/lib/api.ts` (`gameStart`; bot composition rides in
  `config.bots`)
- Test: `app/src/pages/Lobby.test.tsx`

**Interfaces:**
- Consumes: `gameGet` detail (members, config), B5 `game-start`. Bots are
  **not** added via a separate endpoint: the lobby stores bot composition in
  the game `config.bots` (`[{difficulty}]`) at create/join time, and
  `game-start` materializes them (ids `bot-1..n`, names `Easy Bot 1` etc.)
  via `createInitialState`.
- Produces: Lobby UI:
  - Shows game name, invite code with **Copy link** button
    (`${origin}${BASE_URL}#/join/<code>` handled in D/C5 join flow),
    member list, mode badge.
  - **Test mode extras:** board size slider (5–15), starting HP (1–5),
    starting AP (0–10), AP per day (0–5), AP interval minutes (0.5–60,
    test only), upgrade cost (1–5), bots count (0–8) + per-bot difficulty
    select (easy/medium/hard), starting positions note (random).
  - **Start game** button (creator only; disabled until config valid:
    board² ≥ players+bots, etc.). Starts → navigate `/game/:gameId`.
  - Non-creators see "Waiting for host to start…".
- Config values map to `GameConfig` from `@ttt/engine` (import type only —
  engine is a workspace dep).

- [ ] **Step 1: Failing tests** — test mode shows all knobs with defaults
  (board 8, HP 3, AP 0, interval 2 min, 3 easy bots); invalid config
  (board too small for members+bots) disables Start with reason shown.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(app): lobby + config`.

---

### Task C7: GitHub Pages deploy pipeline

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: on push to `main`: install → build app → deploy `app/dist` to
  Pages. Concurrency group; uses `actions/deploy-pages@v4`.

```yaml
name: deploy
on:
  push: { branches: [main] }
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build --workspace @ttt/app
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: app/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 1: Write workflow.** **Step 2: Push to a fork/repo with Pages
  enabled (Settings → Pages → Source: GitHub Actions) and verify the site
  loads** (landing renders at `https://<user>.github.io/tank-turn-tactics/`).
- [ ] **Step 3: Commit** `ci: github pages deploy`.

---

## Definition of Done (Plan C)

- `npm test` green (app units).
- `npm run build` succeeds with `base` set; Pages site live with landing,
  instructions, auth (register + sign-in against hosted backend), dashboard,
  and test-mode lobby with all knobs.
- Guest test-mode session auto-creates and persists.
