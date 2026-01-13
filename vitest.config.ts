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
        'src/contexts/**',
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
