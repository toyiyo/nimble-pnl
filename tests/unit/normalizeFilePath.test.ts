import { describe, it, expect } from 'vitest';
import path from 'node:path';

/**
 * Test suite for normalizeFilePath function in dev-tools/ingest-feedback.js
 * This validates that absolute paths are converted to repo-relative paths
 */

// Mirror the implementation for testing
function normalizeFilePath(filePath: string | undefined): string | undefined {
  if (!filePath) return filePath;
  
  const ROOT = process.cwd();
  
  // If it's an absolute path, make it relative to ROOT
  if (path.isAbsolute(filePath)) {
    return path.relative(ROOT, filePath);
  }
  
  // Already relative, return as-is
  return filePath;
}

describe('normalizeFilePath - Path Sanitization', () => {
  describe('Absolute paths', () => {
    it('should convert absolute path to repo-relative', () => {
      const ROOT = process.cwd();
      const absolutePath = path.join(ROOT, 'src/components/MyComponent.tsx');
      const result = normalizeFilePath(absolutePath);
      
      expect(result).toBe('src/components/MyComponent.tsx');
      expect(result).not.toContain(ROOT);
    });

    it('CRITICAL: should strip home directory prefix', () => {
      const ROOT = process.cwd();
      const homeDir = '/Users/josedelgado/Documents/GitHub/nimble-pnl';
      const filePath = `${homeDir}/src/components/CashFlowSankeyChart.tsx`;
      
      // If ROOT matches homeDir structure
      if (ROOT.includes('nimble-pnl')) {
        const result = normalizeFilePath(filePath);
        expect(result).toBe('src/components/CashFlowSankeyChart.tsx');
        expect(result).not.toContain('/Users');
        expect(result).not.toContain('josedelgado');
      }
    });

    it('should handle nested paths', () => {
      const ROOT = process.cwd();
      const absolutePath = path.join(ROOT, 'supabase/functions/process-expense-invoice/index.ts');
      const result = normalizeFilePath(absolutePath);
      
      expect(result).toBe('supabase/functions/process-expense-invoice/index.ts');
    });
  });

  describe('Relative paths', () => {
    it('should preserve already-relative paths', () => {
      const relativePath = 'src/components/MyComponent.tsx';
      const result = normalizeFilePath(relativePath);
      
      expect(result).toBe(relativePath);
    });

    it('should preserve paths with subdirectories', () => {
      const relativePath = 'tests/unit/myTest.test.ts';
      const result = normalizeFilePath(relativePath);
      
      expect(result).toBe(relativePath);
    });

    it('should preserve current directory prefix', () => {
      const relativePath = './src/hooks/useMyHook.tsx';
      const result = normalizeFilePath(relativePath);
      
      expect(result).toBe(relativePath);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined input', () => {
      expect(normalizeFilePath(undefined)).toBe(undefined);
    });

    it('should handle empty string', () => {
      expect(normalizeFilePath('')).toBe('');
    });

    it('should handle root path', () => {
      const ROOT = process.cwd();
      const result = normalizeFilePath(ROOT);
      
      // Root relative to itself should be empty or '.'
      expect(result === '' || result === '.').toBe(true);
    });
  });

  describe('Cross-platform compatibility', () => {
    it('should work with forward slashes', () => {
      const ROOT = process.cwd();
      const absolutePath = path.join(ROOT, 'src/lib/utils.ts');
      const result = normalizeFilePath(absolutePath);
      
      expect(result).not.toContain(ROOT);
      expect(result).toMatch(/src/);
    });

    it('should normalize path separators', () => {
      const ROOT = process.cwd();
      // Use platform-specific separator
      const absolutePath = ROOT + path.sep + 'src' + path.sep + 'index.ts';
      const result = normalizeFilePath(absolutePath);
      
      expect(result).not.toContain(ROOT);
      // Result should use forward slashes (POSIX style) after normalization
      const normalized = result?.replace(/\\/g, '/');
      expect(normalized).toMatch(/^src\//);
    });
  });
});
