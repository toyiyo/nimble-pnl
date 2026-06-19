import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('tailwind info token', () => {
  const src = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf8');

  it('exposes an info color backed by the --info CSS vars', () => {
    expect(src).toMatch(/info:\s*\{[^}]*hsl\(var\(--info\)\)[^}]*hsl\(var\(--info-foreground\)\)/s);
  });
});
