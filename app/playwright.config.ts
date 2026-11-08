import { defineConfig } from '@playwright/test';

// E2E against the local stack: `supabase start` + `supabase functions serve`
// + `npm run dev --workspace @ttt/app` (or VITE_SUPABASE_URL via E2E env).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 390, height: 844 }, // iPhone 14-ish
    hasTouch: true,
  },
  // e2e tests share the local DB; run serially to avoid name collisions
  workers: 1,
  retries: 0,
  reporter: 'list',
});
