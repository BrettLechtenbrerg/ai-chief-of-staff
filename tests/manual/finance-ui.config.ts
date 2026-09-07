import { defineConfig } from 'vitest/config';

// Explicit local-only browser check; no live Electron services or provider calls.
export default defineConfig({test:{environment:'node',include:['tests/manual/finance-ui.probe.ts'],testTimeout:120000,hookTimeout:30000}});
