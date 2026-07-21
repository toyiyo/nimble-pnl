import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('Labor financial-balance color tokens', () => {
  const src = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');

  const rootBlock = src.match(/:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const darkBlock = src.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';

  const hslTriplet = /-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%/;

  it.each(['--labor-over', '--labor-under', '--labor-balanced'] as const)(
    'defines %s as an HSL triplet in the light :root block',
    (token) => {
      const re = new RegExp(`${token}:\\s*(${hslTriplet.source});`);
      expect(rootBlock).toMatch(re);
    },
  );

  it.each(['--labor-over', '--labor-under', '--labor-balanced'] as const)(
    'defines %s as an HSL triplet in the .dark block',
    (token) => {
      const re = new RegExp(`${token}:\\s*(${hslTriplet.source});`);
      expect(darkBlock).toMatch(re);
    },
  );

  it.each(['--labor-over', '--labor-under', '--labor-balanced'] as const)(
    '%s is NOT aliased to an --splh-* token (design §7: semantics are inverted, must not be shared)',
    (token) => {
      const re = new RegExp(`${token}:\\s*var\\(--splh-`);
      expect(rootBlock).not.toMatch(re);
      expect(darkBlock).not.toMatch(re);
    },
  );
});
