import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/tank-turn-tactics/',
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: './src/setupTests.ts' },
});
