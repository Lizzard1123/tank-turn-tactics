import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The app version: a counter in the repo-root VERSION file, bumped by 1 per
// commit by hooks/pre-commit (seeded with the repo's commit count, so
// version N = Nth commit). Injected at build time — a Pages deploy built
// from commit N reports version N.
const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();

export default defineConfig({
  base: '/tank-turn-tactics/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: { environment: 'jsdom', setupFiles: './src/setupTests.ts', exclude: ['**/node_modules/**', 'e2e/**'] },
});

