# Design: stop ESLint from parsing `.claude/workflows/**`

**Date:** 2026-08-04
**Branch:** `claude/objective-bell-0d5af3`
**Type:** tooling / lint configuration

## Problem

`npm run lint` (`package.json:16` — `"lint": "eslint ."`) reports one
`Parsing error: 'return' outside of function` per Workflow script:

```text
.claude/workflows/dev-build-and-ship.js
  82:3  error  Parsing error: 'return' outside of function

.claude/workflows/dev-continue-verify-and-ship.js
  24:3  error  Parsing error: 'return' outside of function

✖ 2 problems (2 errors, 0 warnings)
```

Both are false positives. Workflow scripts are executed by the Workflow
tool inside an async wrapper, so a top-level `return` is the documented
way to halt a run early — see the preflight guard at
`.claude/workflows/dev-build-and-ship.js:81` and the equivalent at
`.claude/workflows/dev-continue-verify-and-ship.js:23`. The same files
also begin with `export const meta = {...}` — the Workflow tool's
required metadata literal — on line 1 of each file
(`.claude/workflows/dev-build-and-ship.js:1`,
`.claude/workflows/dev-continue-verify-and-ship.js:1`). No single
Node/ESLint parse mode accepts both
constructs at once: `sourceType: "module"` forbids top-level `return`,
and `allowReturnOutsideFunction` is only honoured for
`sourceType: "script"`, which forbids `export`. `node --check` fails on
these files for the identical reason.

The errors are pre-existing on `origin/main`; no change to these files
caused them.

### Why it costs us

`dev-tools/refresh-queue.sh:25` runs
`npm run lint -- --format json` and pipes the result into
`dev-tools/ingest-feedback.js`, which maps ESLint severity `2` to queue
severity `major` (`dev-tools/ingest-feedback.js:221-224`). Every PR that
refreshes the queue therefore inherits two phantom `major` items, and
the Phase 9e gate ("zero open `critical`/`major` in
`dev-tools/review_queue.json`") has to be argued around by hand. This is
the same class of problem recorded in `memory/lessons.md:698-701`, where
repo-wide lint debt made the 9e gate unsatisfiable as literally written.

Note that `npm run lint` is **not** a CI step — `.github/workflows/`
contains no lint job — so the only consumer of this output today is the
local review queue.

## What is actually lost by ignoring these files

Nothing. `eslint.config.js` applies rules through exactly three config
objects: a global `{ ignores: ["dist"] }` (`eslint.config.js:8`), a
`files: ["**/*.{ts,tsx}"]` block (`eslint.config.js:11`), and two
`src/**`-scoped restaurant-clock blocks (`eslint.config.js:33` and
`eslint.config.js:78`). None of them match `.js` outside `src/`.
Verified empirically:

```console
$ npx eslint --print-config .claude/workflows/dev-build-and-ship.js
rules count: 0
```

The workflow scripts get zero rules today. The parse error is the file's
*entire* lint output — 100% noise, with no signal underneath it to lose.
These files are also outside the app bundle and outside `tsconfig`, so
`npm run build` and `npm run typecheck` never see them either.

## Approach

Add `.claude/workflows/**` to the existing global ignores object at
`eslint.config.js:8`:

```js
{ ignores: ["dist", ".claude/workflows/**"] },
```

A config object with only an `ignores` key is a *global* ignore in flat
config, which is what makes `eslint .` skip the directory during file
enumeration rather than merely dropping its rules.

### Alternatives considered

- **Ignore all of `.claude/**`.** Broader than the problem. Only
  `.claude/workflows/` holds the wrapper-executed scripts; keeping the
  ignore narrow means a future `.claude/**/*.ts` helper still gets
  linted.
- **Per-directory `languageOptions` with `allowReturnOutsideFunction`.**
  Does not work: that option is only honoured for
  `sourceType: "script"`, and these files use `export`. This is the
  dead end the problem statement already identifies.
- **Rewrite the scripts to avoid top-level `return`.** Rejected —
  top-level `return` is the Workflow runtime's early-halt contract, used
  by the preflight arg guards. Bending working scripts around a linter
  that grades them with zero rules is backwards.

## Test plan

A new `tests/unit/eslintIgnoresWorkflows.test.ts` drives the ESLint
Node API against the real `eslint.config.js` (the same mechanism
`npm run lint` uses), asserting:

1. Each `.claude/workflows/*.js` script is reported ignored by
   `ESLint#isPathIgnored`.
2. Linting `.claude/workflows/` produces zero error messages.
3. A representative `src/` file is still **not** ignored — the guard
   against a future over-broad ignore silently disabling app linting.

Manual verification: `npm run lint` exits 0 with no parse errors, and
`npx eslint --print-config src/main.tsx` still reports the full rule
set.

## Decided trade-offs

Genuine syntax errors in a workflow script will no longer surface from
`npm run lint`. That is not a regression: today the parse error is
present unconditionally, so it cannot distinguish a broken script from a
working one. Workflow scripts are validated by the Workflow runtime when
they run — the only parser that actually models their execution
environment.
