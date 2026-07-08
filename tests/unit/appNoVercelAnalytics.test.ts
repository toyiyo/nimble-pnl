import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * Regression guard (BUG-001): the app is hosted on Lovable, not Vercel, so
 * `@vercel/analytics` and `@vercel/speed-insights` try to load
 * `/_vercel/insights/script.js`, which 404s on every page load for every
 * user. These packages must not be imported from `src/App.tsx`.
 *
 * Scoped to the two exact specifiers (not a blanket ban on the `@vercel/`
 * prefix) so a deliberate future reintroduction stays legible — see
 * docs/superpowers/specs/2026-07-04-script-error-noise-design.md.
 */
describe('App.tsx does not import dead Vercel analytics packages', () => {
  const appSource = readFileSync(
    path.resolve(__dirname, '../../src/App.tsx'),
    'utf-8'
  );

  it('does not contain the "@vercel/analytics" specifier', () => {
    expect(appSource).not.toContain('@vercel/analytics');
  });

  it('does not contain the "@vercel/speed-insights" specifier', () => {
    expect(appSource).not.toContain('@vercel/speed-insights');
  });
});
