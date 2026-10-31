import { defineConfig } from 'vitest/config';

// pure-logic tier on plain node (the archean-blueprint-tools pyramid rules,
// docs/TEST-PYRAMID.md — the package tier is L1 by construction)
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
