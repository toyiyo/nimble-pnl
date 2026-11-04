// One count-and-word helper for the edge functions and the app.
// src/lib/claimableTrades.ts re-exports it. Keep this file pure: no Deno
// or browser APIs, so vitest and Deno can both import it.

/** "1 hour" or "5 hours". Adds "s" for every count other than 1. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
