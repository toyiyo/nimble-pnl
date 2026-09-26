/**
 * Import rules for the shared labor engine (`supabase/functions/_shared/labor/`).
 *
 * The browser (Vite) and the Deno edge functions both load these files. Deno
 * has no `@/` alias, needs the `.ts` extension on a relative import, and
 * resolves a bare package only through `supabase/functions/deno.json`. No CI
 * job runs Deno, so this test is the guard.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const laborRoot = join(repoRoot, 'supabase', 'functions', '_shared', 'labor');
const denoJsonPath = join(repoRoot, 'supabase', 'functions', 'deno.json');

const ALLOWED_BARE = [/^date-fns$/, /^date-fns\/[\w-]+$/, /^date-fns-tz$/];

// `import ... from 'x'`, `export ... from 'x'`, `import 'x'` and `import('x')`.
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function specifiers(source: string): string[] {
  return [...stripComments(source).matchAll(SPECIFIER_RE)].map((m) => m[1]);
}

function isAllowed(specifier: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return specifier.endsWith('.ts');
  }
  return ALLOWED_BARE.some((re) => re.test(specifier));
}

describe('shared labor engine import rules', () => {
  const files = walk(laborRoot);

  it('finds the engine files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('uses only relative .ts imports, date-fns and date-fns-tz', () => {
    const offenders: string[] = [];
    for (const full of files) {
      for (const specifier of specifiers(readFileSync(full, 'utf8'))) {
        if (!isAllowed(specifier)) {
          offenders.push(`${relative(repoRoot, full)}: '${specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every relative import inside supabase/functions', () => {
    const functionsRoot = join(repoRoot, 'supabase', 'functions');
    const offenders: string[] = [];
    for (const full of files) {
      for (const specifier of specifiers(readFileSync(full, 'utf8'))) {
        if (!specifier.startsWith('.')) continue;
        const target = join(full, '..', specifier);
        if (relative(functionsRoot, target).startsWith('..')) {
          offenders.push(`${relative(repoRoot, full)}: '${specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('maps date-fns, date-fns/ and date-fns-tz in deno.json', () => {
    const denoJson = JSON.parse(readFileSync(denoJsonPath, 'utf8')) as {
      imports: Record<string, string>;
    };
    expect(denoJson.imports['date-fns']).toMatch(/^npm:date-fns@\d/);
    expect(denoJson.imports['date-fns/']).toMatch(/^npm:\/date-fns@\d.*\/$/);
    expect(denoJson.imports['date-fns-tz']).toMatch(/^npm:date-fns-tz@\d/);
  });

  it('rejects the forms that Deno cannot load', () => {
    expect(isAllowed('@/lib/dateOnly')).toBe(false);
    expect(isAllowed('./dateOnly')).toBe(false);
    expect(isAllowed('react')).toBe(false);
    expect(isAllowed('@supabase/supabase-js')).toBe(false);
    expect(isAllowed('./dateOnly.ts')).toBe(true);
    expect(isAllowed('date-fns/format')).toBe(true);
    expect(specifiers("import type { X } from './types.ts';")).toEqual(['./types.ts']);
    expect(specifiers("export * from './a.ts';\nimport('./b.ts');")).toEqual([
      './a.ts',
      './b.ts',
    ]);
  });
});
