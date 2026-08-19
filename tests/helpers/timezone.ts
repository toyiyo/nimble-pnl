import { expect } from 'vitest';

/**
 * Pin the HOST zone to America/Phoenix and prove the pin took effect.
 *
 * Assigning `process.env.TZ` can fail SILENTLY: a Node worker caches the
 * host offset table on first `Date` use, so an earlier `Date` call in the
 * same worker can freeze it, and a runner that pre-sets TZ would leave the
 * assignment inert. Assert the offset instead of trusting the assignment.
 * Phoenix is a fixed UTC-7 and never observes DST, so `getTimezoneOffset()`
 * must report 420 on every date.
 *
 * Shared by every restaurant-clock regression suite so the guard cannot
 * drift between copies. Call in `beforeEach`, and restore
 * `process.env.TZ` in `afterEach` (save the original value before the
 * first call).
 */
export function pinHostTzToPhoenix(): void {
  process.env.TZ = 'America/Phoenix';
  expect(new Date('2026-01-01T12:00:00Z').getTimezoneOffset()).toBe(420);
}
