import { Capacitor } from '@capacitor/core';
import { SpeedInsights } from '@vercel/speed-insights/react';

/**
 * Render Vercel Speed Insights on the web only.
 *
 * Native Capacitor builds serve the app from a local WebView, where the
 * Vercel script `/_vercel/speed-insights/script.js` 404s (BUG-001,
 * docs/superpowers/specs/2026-07-04-script-error-noise-design.md). So skip the
 * beacon on native platforms. See
 * docs/superpowers/specs/2026-08-09-vercel-speed-insights-design.md.
 */
export function SpeedInsightsGate() {
  if (Capacitor.isNativePlatform()) {
    return null;
  }
  return <SpeedInsights />;
}
