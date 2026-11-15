import { test, expect } from '@playwright/test';

// E2E screenshot suite: every route, mobile (390x844) and desktop (1280x800).
// Full-page screenshots are written to docs/screenshots/.
// Requires: supabase local stack + `npm run dev --workspace @ttt/app -- --port 5173`.
// The app is served under the /tank-turn-tactics/ base path (see app/vite.config.ts).

const BASE = 'http://localhost:5173/tank-turn-tactics';
const SCREENSHOT_DIR = 'docs/screenshots';

const MOBILE = { width: 390, height: 844 };   // iPhone 14-ish (matches playwright.config.ts default)
const DESKTOP = { width: 1280, height: 800 };

const PUBLIC_ROUTES = ['/', '/auth', '/instructions'];

function shotPath(viewport: { width: number; height: number }, route: string): string {
  const safe = route.replace(/^\//, '').replace(/\//g, '-') || 'root';
  return `${SCREENSHOT_DIR}/${viewport.width}w-${safe}.png`;
}

async function capture(page, viewport: { width: number; height: number }, route: string) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}${route}`);
  await page.screenshot({ fullPage: true, path: shotPath(viewport, route) });
}

async function capturePublicRoutes(page, viewport: { width: number; height: number }) {
  for (const route of PUBLIC_ROUTES) {
    await capture(page, viewport, route);
  }
}

// Sign in as a guest via Test Mode, then walk the auth-gated routes: game board
// → jury → dashboard → profile. Captures one screenshot per screen.
// TestMode auto-navigates to /game/local (no lobby/start-game button).
async function captureAuthFlow(page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/test`);

  // TestMode auto-signs in and navigates to /game/local (no "Start game" button)
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/game') });

  // Jury screen: navigate to /game/local/jury (dead-player view with board)
  // Note: The jury screen redirects to /game if the player is alive, so we
  // capture whatever renders (could be the game board or an error page).
  await page.goto(`${BASE}/game/local/jury`);
  try {
    await page.waitForTimeout(2000); // Let any redirects settle
    await page.screenshot({ fullPage: true, path: shotPath(viewport, '/game-jury') });
  } catch {
    // Jury may not render if no game data — skip
  }

  // Dashboard: requires auth + Supabase calls (will show if session exists)
  await page.goto(`${BASE}/games`);
  await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/dashboard') });

  // Profile: requires auth
  await page.goto(`${BASE}/profile`);
  await expect(page.getByTestId('app-version')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/profile') });
}

test.describe('screenshots @ mobile (390x844)', () => {
  test.use({ viewport: MOBILE });

  test('public routes: landing, auth, instructions', async ({ page }) => {
    await capturePublicRoutes(page, MOBILE);
  });

  test('auth flow: game, jury, dashboard, profile', async ({ page }) => {
    await captureAuthFlow(page, MOBILE);
  });
});

test.describe('screenshots @ desktop (1280x800)', () => {
  test.use({ viewport: DESKTOP });

  test('public routes: landing, auth, instructions', async ({ page }) => {
    await capturePublicRoutes(page, DESKTOP);
  });

  test('auth flow: game, jury, dashboard, profile', async ({ page }) => {
    await captureAuthFlow(page, DESKTOP);
  });
});
