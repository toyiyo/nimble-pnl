# Plan: off-site punch E2E midnight flake

Design: `docs/superpowers/specs/2026-10-07-offsite-punch-midnight-flake-design.md`

## Task 1: Show the failure (RED)

1. Add `await page.clock.setSystemTime(<today 00:10 local>)` before the seed,
   in a local scratch copy only.
2. Run `npx playwright test tests/e2e/offsite-punch-flag.spec.ts`.
3. Expect the "element(s) not found" failure on the off-site button.

## Task 2: Clamp the seed (GREEN)

1. In `tests/e2e/offsite-punch-flag.spec.ts`, compute `punchTime` in
   `page.evaluate`: the later of `now - 30 min` and local start of today.
2. Run the scratch copy with the 00:10 clock. Expect a pass.
3. Run the real spec without a fake clock. Expect a pass.
4. Delete the scratch copy. Commit the spec.

## Task 3: Verify and ship

1. Run `npm run lint` and `npm run typecheck`.
2. Push, open the PR, hand it to Auto-fix, triage comments.
