---
name: qa
description: QA the current work like a human tester. Start the app on local Supabase, drive the changed flows in Chromium, and check roles, empty and error states, mobile width, keyboard access, console errors, and data correctness. Write a report with screenshots. Use when asked to "QA", "test like a user", "smoke test", "click through", or "check the change in the browser". Mandatory Phase 8.5 of every /dev run (fix mode).
---

# QA

This skill tests **behavior**, not code. Phase 8 (Verify) proves that the code
passes the tests its author wrote. QA uses the running app as a tester does
and looks for what those tests do not cover.

Write every word in ASD-STE100 (see `CLAUDE.md` and `docs/STE100_STYLE.md`).

## Arguments

`/qa [<PR number>] [--fix] [focus text]`

| Argument | Effect |
|---|---|
| none | Test the current branch diff against `origin/main`. Report mode. |
| `<PR number>` | Test that PR. Check out its head branch first. Use the PR body as the acceptance source. |
| `--fix` | Fix mode (Step 6). `/dev` Phase 8.5 always uses fix mode. |
| focus text | Add the text to the charter as extra rows. Example: `/qa the tip split dialog on mobile`. |

**Report mode** finds and reports bugs. It changes no committed file.
**Fix mode** also fixes `critical` and `major` bugs, with a regression test
for each.

## Hard rules

- **Never run QA against production.** If `.env.local` does not point at local
  Supabase, stop and return `needs_human`. Sign-ups against production create
  real accounts.
- **Never use production data.** Use generated test users only. No real name,
  email, or restaurant goes into a scratch spec, a screenshot, or the report
  (`memory/lessons.md`, "Real production data ... leaked").
- **Evidence before a verdict.** Each `pass` needs a spec assertion or a
  screenshot. "It looks fine" is not a verdict.
- **Bounded waits only.** Run Playwright in the foreground and let the Bash
  tool's `timeout` bound it. Kill every server you start, on the failure path
  too (`CLAUDE.md`, "No Unbounded Waits").
- **Explicit staging.** In fix mode, stage explicit paths only. Never stage
  `dev-tools/qa/` or `progress.md`.

## Step 1 — Scope

```bash
git fetch origin main --quiet
git diff origin/main...HEAD --name-only
git log origin/main..HEAD --format='%s%n%b'
```

Find the acceptance source, in this order:

1. The design doc and plan (`/dev` passes both paths).
2. The PR body (`/qa <PR>`).
3. The commit messages, plus the focus text.

**The only skip.** If the diff touches only docs, `.claude/`, `.github/`, or
other config with no runtime effect, do not start the app. Write the report
with a one-sentence exception and return `qaPassed=true` with `exception` set.
A change under `src/` or `supabase/` is never an exception.

## Step 2 — Environment preflight

Check each item. Print the raw value before you decide.

```bash
test -x node_modules/.bin/vite && echo "vite ok" || echo "vite missing"
grep -E '^[[:space:]]*VITE_SUPABASE_URL[[:space:]]*=' .env.local
npx supabase status
```

1. `node_modules/.bin/vite` must exist. If not, run `npm install`.
2. `VITE_SUPABASE_URL` must match
   `http://(127\.0\.0\.1|localhost):54321`. If not, stop: `needs_human`.
3. `npx supabase status` must show a running stack. If not, run
   `npm run db:start` once. If it still fails, stop: `needs_human`.
4. Kill any stale dev server on the Playwright port. Playwright reuses a
   server that answers on the port, and a stale server serves old code
   (`memory/lessons.md`, "A stale long-running `npm run dev`").
   `playwright.config.ts` derives the port from the checkout path, and
   `E2E_PORT` overrides it. Run this from the repo root. It uses the same
   formula as the config:

   ```bash
   PORT=${E2E_PORT:-$(node -e 'console.log(10000 + ([...process.cwd()].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381) % 20000))')}
   PIDS=$(lsof -ti "tcp:$PORT"); echo "port=$PORT pids=${PIDS:-none}"
   [ -n "$PIDS" ] && kill $PIDS
   rm -rf node_modules/.vite
   ```

   Never find the server with `ps aux | grep` (`CLAUDE.md`, "No Unbounded
   Waits").
5. If the change includes a migration, run `npm run db:reset` so the local
   schema matches the branch.

Record the output of each check in the report.

## Step 3 — Charter

Write a charter table before you write a spec. One row per user-facing
behavior the change touches.

| # | Behavior | Acceptance criterion | Data precondition | Lenses |
|---|---|---|---|---|

- Take the behaviors from the acceptance source, not from the tests.
- Name the **data precondition** for each row. A bug that needs specific data
  does not show on an empty seed (`memory/lessons.md`, "Data-dependent UI
  bugs"). Example: "an approved time-off request that overlaps this week".
- Add **one adjacent flow**: a screen that imports a changed component or
  hook. Find it with `grep -rln "<ChangedExport>" src/`.
- A backend-only change (RPC, edge function, migration) still gets rows. Drive
  it through the UI that calls it. If no UI calls it yet, call it with
  `supabase-js` as a signed-in test user, not as the service role.

## Step 4 — Execute

### Where the scratch specs live

```text
dev-tools/qa/                       (gitignored)
├── scratch/*.spec.ts               the QA specs for this run
├── evidence/*.png                  screenshots
├── test-results/                   Playwright output
└── qa-report-<branch-slug>.md      the report
```

Delete `dev-tools/qa/scratch/` and `dev-tools/qa/evidence/` at the start of
each run. Old specs from another branch give false results.

Run the specs with the QA config:

```bash
npx playwright test --config .claude/skills/qa/playwright.qa.config.ts
```

The QA config (`.claude/skills/qa/playwright.qa.config.ts`) reuses the main
config: same port, same `webServer`, same browser. It only changes where the
specs and the output live. `npm run test:e2e` never runs the scratch specs.

### How to write a scratch spec

Import the E2E helpers with a relative path from `dev-tools/qa/scratch/`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant } from '../../../tests/helpers/e2e-supabase';

const EVIDENCE = 'dev-tools/qa/evidence';

// Collect console errors and failed responses for every test (lens 8).
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return problems;
}

test('row 1: owner creates a prep item and it persists', async ({ page }) => {
  const problems = watch(page);
  const user = generateTestUser('qa-row1');
  await signUpAndCreateRestaurant(page, user);
  // ... drive the flow with getByRole / getByLabel ...
  await page.screenshot({ path: `${EVIDENCE}/row1-desktop.png`, fullPage: true });
  await page.reload();
  // ... assert that the data persists ...
  expect(problems).toEqual([]);
});
```

- Use accessible locators (`getByRole`, `getByLabel`). A control that has no
  accessible name is a finding (lens 7).
- Seed data with the `tests/helpers/` functions. When RLS blocks the seed,
  use a service-role client in the Node test process
  (`tests/helpers/e2e-service-role.ts`). Never expose the service role to the
  browser page.
- Name each test `row <n>: ...` so the report can map results to the charter.

### The lenses

Apply each lens that fits the row. Mark a lens `n/a` with a reason when it
does not fit.

1. **Happy path and persistence.** Do the task end to end. Reload. The data
   is still there and correct.
2. **Loading, empty, and error states.** Look at the screen with no data.
   Force an error with `page.route(<glob>, (r) => r.fulfill({ status: 500 }))`.
   The screen shows an error message, not a blank area or a crash.
3. **Input edges.** Blank, zero, negative, decimals, very long text, special
   characters (`O'Brien`, `<b>`, emoji). Date edges: midnight, a DST change,
   and the restaurant timezone versus the browser timezone.
4. **Roles.** Owner, manager, staff, and a collaborator role when relevant. A
   role without access cannot see the action and cannot do it through the URL.
5. **Tenant isolation.** Create a second restaurant with its own data. Its
   data never shows in the first restaurant.
6. **Viewports.** 1280x800 and 390x844 (`page.setViewportSize`). No horizontal
   page scroll:
   `await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)`.
   All controls are visible and usable.
7. **Keyboard and accessibility.** Tab reaches every control in a logical
   order. A dialog traps focus, and Escape closes it. Icon-only buttons have
   an `aria-label`. Inputs have labels.
8. **Console and network.** Zero console errors and zero responses with
   status >= 400 that the change causes.
9. **Data correctness.** Each number on screen (money, quantity, hours)
   matches an independent calculation or a direct DB query. Check rounding
   and units (`fl oz` versus `oz`).
10. **Flow abuse.** Double-click the submit button. Use the browser back
    button. Reload in the middle of the flow. No duplicate record, no stuck
    state.

## Step 5 — Report

Write `dev-tools/qa/qa-report-<branch-slug>.md`. The branch slug is the
branch name with each character outside `A-Za-z0-9._-` changed to `-`.

```markdown
# QA report — <branch>

Mode: report | fix. Date. HEAD SHA. Acceptance source.

## Preflight
<raw output of each Step 2 check>

## Charter
| # | Behavior | Lenses run | Verdict | Evidence |
|---|---|---|---|---|
| 1 | ... | 1,2,4,6,8 | pass | row1-desktop.png, scratch/row1.spec.ts |

## Bugs
| ID | Severity | Row | Steps to reproduce | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|---|

## Verdict
PASS | FAIL — one sentence.
```

### Severity

| Severity | Meaning |
|---|---|
| `critical` | Wrong money or inventory numbers, data loss, a security or tenant leak, or a crash in a main flow. |
| `major` | An acceptance criterion fails, a role cannot do its job, the flow breaks at 390px, or the change causes a console error. |
| `minor` | Cosmetic, copy, or spacing. The task still works. |

A bug that is also on `origin/main` is **pre-existing**. Record it with the
tag `pre-existing`. It does not block the verdict. In `/dev`, list it in
`minorFindings` so the PR body shows it.

## Step 6 — Fix loop (fix mode only)

For each open `critical` or `major` bug:

1. Write a regression test that fails. Use `tests/e2e/<area>.spec.ts` for a
   flow bug, or `tests/unit/<name>.test.ts` for a logic bug. Run it and see
   it fail for the reason in the bug.
2. Fix the code. Follow `CLAUDE.md` (semantic tokens, three states,
   accessibility, React Query `staleTime`).
3. Run the regression test and see it pass.
4. Commit explicit paths only:
   `fix(qa): <what> — QA bug <ID>`.
5. Re-run the charter rows that the fix can affect.

Max **3 rounds** through the bug list. If a `critical` or `major` bug stays
open after round 3, stop and return `needs_human` with the bug ID and the
last result.

Fix a `minor` bug only when the fix is one line and changes no behavior.
Leave the other minors open and list them.

After a fix, `/dev` re-runs the full Verify suite before Ship. In standalone
`/qa --fix`, run `npm run test`, `npm run typecheck`, and `npm run lint`
yourself before you report.

## Step 7 — Result

**`/dev` Phase 8.5** returns this object to the workflow:

| Field | Value |
|---|---|
| `status` | `completed`, `needs_human`, or `failed` |
| `qaPassed` | `true` only if every charter row is `pass` or a justified `n/a`, and zero `critical` or `major` bugs stay open |
| `reportPath` | the report path |
| `exception` | the one-sentence reason, only for the Step 1 skip |
| `charterRows` | the number of charter rows |
| `bugsFixed` | the number of bugs fixed in Step 6 |
| `minorFindings` | `[{ title, severity, evidence }]` for each open minor or pre-existing bug |
| `commits` | each commit SHA from Step 6 |

**Standalone `/qa`** shows the user:

- The verdict (PASS or FAIL) and the report path.
- The charter table.
- Each bug with its severity and screenshot path.
- In report mode, one line that offers `/qa --fix`.

Before you return, kill every server you started. Keep `dev-tools/qa/` for
the user to read. It is gitignored.
