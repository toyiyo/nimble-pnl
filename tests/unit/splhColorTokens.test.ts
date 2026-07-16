import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('SPLH heatmap color tokens', () => {
  const src = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');

  const rootBlock = src.match(/:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const darkBlock = src.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';

  const hslTriplet = /-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%/;

  it.each(['--splh-lean', '--splh-slack', '--splh-balanced'] as const)(
    'defines %s as an HSL triplet in the light :root block',
    (token) => {
      const re = new RegExp(`${token}:\\s*(${hslTriplet.source});`);
      expect(rootBlock).toMatch(re);
    },
  );

  it.each(['--splh-lean', '--splh-slack', '--splh-balanced'] as const)(
    'defines %s as an HSL triplet in the .dark block',
    (token) => {
      const re = new RegExp(`${token}:\\s*(${hslTriplet.source});`);
      expect(darkBlock).toMatch(re);
    },
  );
});
