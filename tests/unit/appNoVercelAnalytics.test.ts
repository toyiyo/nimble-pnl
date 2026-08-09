import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * Regression guard: `src/App.tsx` does not add Vercel Web Analytics
 * (`@vercel/analytics`). PostHog already captures product analytics
 * (pageviews and pageleaves in `src/main.tsx`), so Web Analytics would
 * duplicate it. See
 * docs/superpowers/specs/2026-08-09-vercel-speed-insights-design.md.
 *
 * BUG-001 history: this file once also banned `@vercel/speed-insights`,
 * because the app ran on Lovable, where the Vercel script 404s. Production
 * now deploys to Vercel, so Speed Insights is deliberately reintroduced
 * through `src/components/SpeedInsightsGate.tsx` (web only, off on native
 * Capacitor builds). So the speed-insights ban is gone; the
 * `@vercel/analytics` ban stays. See
 * docs/superpowers/specs/2026-07-04-script-error-noise-design.md.
 */
describe('App.tsx does not import Vercel Web Analytics', () => {
  const appSource = readFileSync(
    path.resolve(__dirname, '../../src/App.tsx'),
    'utf-8'
  );

  it('does not contain the "@vercel/analytics" specifier', () => {
    expect(appSource).not.toContain('@vercel/analytics');
  });
});
