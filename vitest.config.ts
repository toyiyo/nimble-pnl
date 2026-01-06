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
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/utils/**/*.ts',
        'src/lib/utils.ts',
        'src/hooks/utils/**/*.ts',
        'src/hooks/useRevenueBreakdown.tsx',
        'src/hooks/useEmployeeTips.tsx',
        'src/hooks/useAutoSaveTipSettings.ts',
        'src/hooks/useShiftTrades.ts',
        'src/components/tips/TipSubmissionDialog.tsx',
        'supabase/functions/_shared/periodMetrics.ts',
        'supabase/functions/_shared/monthlyMetrics.ts',
        'supabase/functions/_shared/inventoryConversion.ts',
      ],
      exclude: ['**/*.d.ts', '**/*.test.ts', '**/*.test.tsx'],
      reportsDirectory: './coverage',
    },
    testTimeout: 10000,
  },
});
