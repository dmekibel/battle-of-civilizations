import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /<repo-name>/.
export default defineConfig({
  base: '/battle-of-civilizations/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
