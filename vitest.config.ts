import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'tests/setup.ts')],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/perf/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/**/*.{ts,tsx}',
        'supabase/functions/_shared/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'tests/**',
        'src/components/**',
        'src/pages/**',
        // Only the provider components are excluded (they are exercised via
        // Playwright, not unit tests). Plain-.ts logic modules under contexts/
        // — e.g. viewModeStore.ts — are unit-tested and must report coverage;
        // sonar-project.properties excludes `src/contexts/**/*.tsx` only, so
        // excluding all of `src/contexts/**` here made Sonar count those lines
        // as new-code-to-cover with no lcov data behind them.
        'src/contexts/**/*.tsx',
        // Data-fetch hook relocated verbatim from StaffingOverlay (a coverage-
        // excluded component); its pure math is covered via computeStaffingSuggestions.
        'src/hooks/useWeekStaffingSuggestions.ts',
        'src/integrations/**',
        'src/types/**',
        'src/App.tsx',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      reportsDirectory: './coverage',
    },
    testTimeout: 10000,
  },
});
