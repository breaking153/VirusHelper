import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { target: ['es2021', 'safari15'] },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  test: {
    // Release assembly uses node:test and is run by the second half of npm test.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
  },
});
