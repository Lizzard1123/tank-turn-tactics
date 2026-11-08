import { test, expect } from '@playwright/test';

// E2E screenshot suite: every route, mobile (390x844) and desktop (1280x800).
// Full-page screenshots are written to docs/screenshots/.
// Requires: supabase local stack + `npm run dev --workspace @ttt/app -- --port 5173`.
// The app is served under the /tank-turn-tactics/ base path (see app/vite.config.ts).

const BASE = '/tank-turn-tactics';
const SCREENSHOT_DIR = '../docs/screenshots';

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

// Sign in as a guest via Test Mode, then walk the auth-gated routes: lobby ->
// start game -> board -> jury -> dashboard -> profile. Captures one screenshot
// per screen and returns the lobby gameId.
async function captureAuthFlow(page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/test`);

  // guest auto-signin + game create happen automatically; host lands in lobby
  await expect(page.getByRole('button', { name: /start game/i })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/lobby') });

  const gameId = page.url().split('/lobby/')[1].split('?')[0];

  await page.getByRole('button', { name: /start game/i }).click();
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/game') });

  await page.goto(`${BASE}/game/${gameId}/jury`);
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/game-jury') });

  await page.goto(`${BASE}/dashboard`);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/dashboard') });

  await page.goto(`${BASE}/profile`);
  await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ fullPage: true, path: shotPath(viewport, '/profile') });

  return gameId;
}

test.describe('screenshots @ mobile (390x844)', () => {
  test.use({ viewport: MOBILE });

  test('public routes: landing, auth, instructions', async ({ page }) => {
    await capturePublicRoutes(page, MOBILE);
  });

  test('auth flow: lobby, game, jury, dashboard, profile', async ({ page }) => {
    await captureAuthFlow(page, MOBILE);
  });
});

test.describe('screenshots @ desktop (1280x800)', () => {
  test.use({ viewport: DESKTOP });

  test('public routes: landing, auth, instructions', async ({ page }) => {
    await capturePublicRoutes(page, DESKTOP);
  });

  test('auth flow: lobby, game, jury, dashboard, profile', async ({ page }) => {
    await captureAuthFlow(page, DESKTOP);
  });
});
