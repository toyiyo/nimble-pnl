import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { PostHogProvider } from 'posthog-js/react';

const POSTHOG_KEY = 'YOUR_POSTHOG_KEY_HERE'; // Replace with your actual PostHog key
const POSTHOG_HOST = 'https://us.i.posthog.com';

const options = {
  api_host: POSTHOG_HOST,
  person_profiles: 'identified_only' as const,
  capture_pageview: true,
  capture_pageleave: true,
};

createRoot(document.getElementById("root")!).render(
  <PostHogProvider apiKey={POSTHOG_KEY} options={options}>
    <App />
  </PostHogProvider>
);
