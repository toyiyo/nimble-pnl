/**
 * Source-level guard for the schedule grid scroller in Scheduling.tsx.
 *
 * The grid's overflow-x-auto wrapper must also be `relative` so that ANY
 * absolutely positioned descendant of the table (current or future)
 * resolves its containing block at or below the scroller and gets clipped
 * by it, instead of leaking into documentElement scroll width on mobile.
 *
 * Rendering Scheduling.tsx is prohibitively hook-heavy (see
 * memory/lessons.md — PR #504), so this parses the single className token
 * that contains overflow-x-auto and asserts `relative` is one of its
 * whitespace-split class tokens (same element — not a loose file regex).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Scheduling grid scroller', () => {
  it('pairs overflow-x-auto with relative on the same element', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/pages/Scheduling.tsx'),
      'utf8'
    );

    const classAttrs = [...src.matchAll(/className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((cls) => cls.split(/\s+/).includes('overflow-x-auto'));

    // Exactly one grid scroller exists in this page today; if that changes,
    // every one of them must carry `relative`.
    expect(classAttrs.length).toBeGreaterThan(0);
    for (const cls of classAttrs) {
      expect(cls.split(/\s+/)).toContain('relative');
    }
  });
});
