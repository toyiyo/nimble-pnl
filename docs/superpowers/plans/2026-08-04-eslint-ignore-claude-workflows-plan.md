# Plan: stop ESLint from parsing `.claude/workflows/**`

Design: `docs/superpowers/specs/2026-08-04-eslint-ignore-claude-workflows-design.md`

## Task 1 — RED: failing guard test

Add `tests/unit/eslintIgnoresWorkflows.test.ts` driving the ESLint Node
API against the repo's real `eslint.config.js`:

- every `.claude/workflows/*.js` is reported ignored by `isPathIgnored`
- linting `.claude/workflows/` yields zero error messages
- `src/main.tsx` is **not** ignored (over-broad-ignore guard)

Expect the first two to fail before the config change.

## Task 2 — GREEN: add the ignore

`eslint.config.js:8` → `{ ignores: ["dist", ".claude/workflows/**"] }`,
with a comment explaining why (top-level `return` + `export` is legal in
the Workflow runtime and unparseable by any single ESLint mode).

Test goes green.

## Task 3 — Confirm no rule coverage was lost

- `npx eslint --print-config src/main.tsx` still returns the full rule
  set (spot-check `react-hooks/*` and `no-restricted-syntax` present).
- `npx eslint --print-config .claude/workflows/dev-build-and-ship.js`
  before the change already reported `rules count: 0` — recorded in the
  design doc as the evidence that nothing is lost.

## Task 4 — Verify

`npm run lint` (expect exit 0, no parse errors), `npm run typecheck`,
`npm run test`, `npm run build`.

E2E: **justified exception** — lint-configuration-only change with no
user-facing behaviour and no runtime code in the app bundle. The ESLint
Node-API test in Task 1 exercises the only seam that exists.

## Task 5 — Ship

Commit, push, PR, CI green, triage review comments.
