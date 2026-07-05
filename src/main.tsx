import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { PostHogProvider } from 'posthog-js/react';
import { initFaro } from './lib/faro';
import { setupDeepLinkAuth } from './utils/capacitorAuth';
import { isUnactionableScriptError } from './lib/errorTrackingFilter';

// Initialize Grafana Faro for frontend observability (must be first)
initFaro();

// Listen for OAuth deep link callbacks on native (must be before render)
setupDeepLinkAuth();

// Validate PostHog environment variables
const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

// Build options only when host is present.
// NOTE: this object is intentionally a module-level constant (created once,
// outside React). If it's ever moved inside a component, it must be
// memoized (e.g. useMemo) — a new object identity on every render would
// make PostHogProvider re-initialize the client on every render.
const posthogOptions = POSTHOG_HOST ? {
  api_host: POSTHOG_HOST,
  person_profiles: 'identified_only' as const,
  capture_pageview: true,
  capture_pageleave: true,
  before_send: (event) => (isUnactionableScriptError(event) ? null : event),
} : null;

// Check if PostHog is properly configured
const isPostHogConfigured = !!(POSTHOG_KEY && posthogOptions);

// Log warning if PostHog env vars are missing
if (!POSTHOG_KEY) {
  console.warn('PostHog API key is not configured. Analytics will be disabled.');
}
if (!POSTHOG_HOST) {
  console.warn('PostHog host is not configured. Analytics will be disabled.');
}

// Conditionally wrap app with PostHogProvider
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);

if (isPostHogConfigured) {
  root.render(
    <PostHogProvider apiKey={POSTHOG_KEY} options={posthogOptions}>
      <App />
    </PostHogProvider>
  );
} else {
  root.render(<App />);
}
