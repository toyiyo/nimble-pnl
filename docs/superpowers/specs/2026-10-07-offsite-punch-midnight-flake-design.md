# Off-site punch E2E: fix the flake near midnight

## Problem

`tests/e2e/offsite-punch-flag.spec.ts:63` seeds the punch at
`new Date(Date.now() - 30 * 60 * 1000)`. Between 00:00 and 00:30 in the
browser time zone, that time is on the previous calendar day.

`/time-punches` opens in day view on today. The page sets
`viewMode` to `'day'` (`src/pages/TimePunchesManager.tsx:91`) and
`currentDate` to `new Date()` (`src/pages/TimePunchesManager.tsx:93`).
The day range is `startOfDay(currentDate)` to `endOfDay(currentDate)`
(`src/pages/TimePunchesManager.tsx:290`). These `date-fns` helpers use the
browser local time zone.

The off-site count reads only punches inside that range
(`src/pages/TimePunchesManager.tsx:339-347`). `isWithinWindow` includes both
ends (`supabase/functions/_shared/labor/punchWindow.ts:98-101`). A punch from
yesterday is not counted. The button "1 off-site punch. Show them in the
punch list." does not show, and the test fails with "element(s) not found".

Evidence: PR #844, run 37549690489, E2E Shard 2/4, failed at 00:19 UTC. That
branch did not touch time punches.

## Fix

Compute the punch time inside the browser with `page.evaluate`. Use the
later of two times:

- `now - 30 min`
- the start of today in the browser local time zone

The browser zone is the zone the page uses for its range. The result is
never in the future, and it is always at or after `startOfDay(today)`.
`isWithinWindow` includes the start, so the start itself is a valid value.

## Other specs

A grep of `tests/e2e/` for `Date.now() - N * 60 * 1000`, `getTime() -`,
`subHours`, and `subMinutes` finds no other spec that seeds a relative time
into a "today" view. `bank-transaction-filtering.spec.ts:119-162` seeds
transactions some days back, but that page has no default day filter. No
other change is necessary.

## Decided trade-offs

- A run that starts at 23:59:59 and loads the page after 00:00 still sees a
  new "today". The window is a few seconds, not 30 minutes. A fake clock
  (`page.clock`) would close it, but it also changes auth token times. We
  accept the small window.

## Testing

The spec is the test. Run it with the local stack. Also run it with the
browser clock at 00:10 local time to show the old seed fails and the new seed
passes.
