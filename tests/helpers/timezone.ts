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
 * The check date matters: it must land inside another US zone's DST
 * window, so a leaked host zone reports an offset that differs from
 * Phoenix's fixed 420. `2026-03-09` sits after the 2026 US DST switch
 * (2026-03-08), so America/Denver reports 360 there, not 420 -- a date
 * outside DST (e.g. January) would let a Denver host pass this guard
 * with the wrong zone still in effect, because Denver's winter offset
 * also happens to be 420.
 *
 * Shared by every restaurant-clock regression suite so the guard cannot
 * drift between copies. Call in `beforeEach`, and restore
 * `process.env.TZ` in `afterEach` (save the original value before the
 * first call).
 */
export function pinHostTzToPhoenix(): void {
  process.env.TZ = 'America/Phoenix';
  expect(new Date('2026-03-09T12:00:00Z').getTimezoneOffset()).toBe(420);
}
