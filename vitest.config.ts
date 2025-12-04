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
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/utils/**/*.ts',
        'src/hooks/utils/**/*.ts',
        'src/hooks/useRevenueBreakdown.tsx',
        'supabase/functions/_shared/periodMetrics.ts',
        'supabase/functions/_shared/monthlyMetrics.ts',
        'supabase/functions/_shared/inventoryConversion.ts',
      ],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
      reportsDirectory: './coverage',
    },
    testTimeout: 10000,
  },
});
