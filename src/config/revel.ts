/**
 * Revel POS integration gate. Enable per-environment via VITE_REVEL_ENABLED=true
 * (e.g. in .env.local for local testing). Defaults to false so the card renders
 * visible-but-disabled ("Coming soon") until a deployment opts in.
 */
export const REVEL_ENABLED = import.meta.env.VITE_REVEL_ENABLED === 'true';
