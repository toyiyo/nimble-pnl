# Progress: Route-level code splitting (mobile LCP fix)

## Spec
- Design: docs/superpowers/specs/2026-06-07-route-code-splitting-design.md
- Plan:   docs/superpowers/plans/2026-06-07-route-code-splitting-plan.md

## Current Phase
Phase 4–9 relaunching (autonomous) after rebasing onto latest main.

## Rebase note
- Rebased onto origin/main d2db73e0 (picks up: updated /dev Phase 7a ocr-rules reviewer #539, xlsx→SheetJS CDN dep #533, timeoff fix #537).
- First run (wf_a6d05bf5-6a5) stopped mid-Phase-4 (Task 1 committed, Task 2 WIP). Phase 4 reset to a clean docs-only slate so the updated orchestrator re-runs all tasks deterministically. npm install re-run (exit 0).

## Completed Tasks
- [x] Phase 0 — lessons consulted
- [x] Phase 1 — worktree `perf/route-code-splitting` (now based on d2db73e0)
- [x] Phase 2 — design committed (e60c1ff0)
- [x] Phase 2.5 — frontend design review folded (5d686e44); supabase reviewer N/A
- [x] Phase 3 — plan committed (facbcac9)
- [ ] Phase 4 — TDD build (Tasks 1–7) [in progress]
  - [x] Task 1 — lazyWithRetry helper (3eb323c3)
  - [x] Task 2 — RouteFallback component + test (181f2a8c)
  - [x] Task 3 — RouteErrorBoundary component + test (44b793bb)
  - [x] Task 4 — Dynamic-import tesseract.js in ocrService + test (88ea841c)
  - [x] Task 5 — Normalize self-defeating dual imports (dd742f1f)
  - [x] Task 6 — Wire App.tsx — lazy routes + Suspense + ErrorBoundary + startTransition (3152669b)
        Entry chunk: 5,833 KB → 954 KB raw (84% reduction). All 4483 tests pass.
  - [x] Task 7 — Verify bundle reduction + Capacitor build smoke-test (see commit below)
        Bundle verification results (Phase 4, Task 7):
        - Entry chunk (web):  5,833 KB → 954 KB raw / 290 KB gzip (83.6% raw reduction)
        - Capacitor build:    954 KB raw / 290 KB gzip — relative asset refs confirmed (./assets/...)
        - Route chunks:       54 lazy page chunks created (out of 57 routes; 3 share vendor chunks)
        - Tesseract:          NOT in any static chunk — dynamically imported at point-of-use ✓
        - Tests:              4,483/4,485 passed (2 intentionally skipped) ✓
        - Typecheck:          PASS (no errors) ✓
        - Lint:               1,441 pre-existing errors (none introduced by this PR; our new files: 0 errors) ✓
        - Build (web):        PASS in 16.5s ✓
        - Build (Capacitor):  PASS in 13.5s; ./assets/ relative paths confirmed ✓
        - Manual pre-release: npx cap sync + iOS/Android simulator smoke-load of /, /auth, /employee/pay required before App Store release
- [x] Phase 5 — UI review (RouteFallback/RouteErrorBoundary) (deef9244)
  - Fix: RouteErrorBoundary h2 text-[14px] font-medium → text-[17px] font-semibold (dialog-title spec)
  - Fix: button add transition-colors for hover smoothness
  - RouteFallback fully compliant — no changes needed
- [x] Phase 6 — simplify (4a2ce9dd)
  - RouteErrorBoundary.handleReload: if/else → (onReload ?? reload)()
  - App.tsx: removed duplicate mid-block "Named-export pages" comment (banner already says it) and "Default-export pages (continued)" noise comment
- [x] Phase 7 — multi-model review (incl. ocr-rules) + CodeRabbit
  - [x] Phase 7a — Codex adversarial review: 1 major finding in src/lib/lazyWithRetry.ts line 61
        Finding: when sessionStorage unavailable, reload guard is never persisted → infinite reload loop instead of RouteErrorBoundary
  - [x] Phase 7b — Fold findings (3 commits):
        • 25e0abc4: fix(review): infinite reload loop when storage=null — lazyWithRetry.ts (critical; all 5 reviewers)
          Storage null → treat as already-reloaded; add `null` sentinel to LoadOptions.storage; new regression test (6/6 pass)
        • 496946c1: fix(review): RouteErrorBoundary never resets on navigation — sound-logic
          getDerivedStateFromProps resets hasError on pathname change; LocationKeyedErrorBoundary wrapper wires useLocation()
        • 2f2f9ecc: fix(review): aria-live=polite on RouteFallback — ocr-rules
          Explicit aria-live per approved plan spec
        Skipped (style/nits for CodeRabbit): import order in App.tsx, WHAT comment in App.tsx
- [x] Phase 8 — verify (test/typecheck/lint/build + CAPACITOR build)
      Phase 8 results (2026-06-07):
      - npm run test:          4484 passed / 2 skipped (341 test files). PASS ✓
      - npm run test:db:       1373 passed / 1 failed (pre-existing: 32_weekly_brief_queue.sql test 9 assumes no restaurants in DB; our branch touches no supabase/ files). PRE-EXISTING ✓
      - npm run test:e2e:      142 passed / 12 skipped / 2 failed (scheduling-conflicts.spec.ts tests 284+366; pre-existing, untouched by our branch). PRE-EXISTING ✓
      - npm run typecheck:     PASS (no errors) ✓
      - npm run lint:          1441 pre-existing errors (none in our new files; confirmed 0 errors in lazyWithRetry.ts, RouteFallback.tsx, RouteErrorBoundary.tsx, test files) ✓
      - npm run build:         PASS in 19.37s; entry chunk 954 KB raw / 290 KB gzip ✓
      - .env.local symlink:    present → /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local ✓
- [x] Phase 9a — push branch + open PR #540
- [ ] Phase 9b — CI feedback loop + comment triage
- [ ] Phase 10 — retrospective

## CI Status
- PR: https://github.com/toyiyo/nimble-pnl/pull/540

## Key Decisions
- Scope: PR1 = route code-splitting only.
- Approach A+: React.lazy(lazyWithRetry) all 57 pages + top-level Suspense + RouteErrorBoundary + v7_startTransition.
- Native (Capacitor) guard: disable reload-on-fail in native to avoid reload loops.
- Include: tesseract.js dynamic import; fix 3 self-defeating dual imports.
- Defer to follow-ups: xlsx/jspdf click-time import, per-content Suspense, lazy AiChatPanel, runtime fixes #2–#5.

## Baseline (confirm in Phase 8)
- Entry chunk before: index-*.js = 5,833 KB raw / 1,587 KB gzip; total JS 9,527 KB / 2,669 KB gzip.
- Mobile Safari LCP p75 ~23s; desktop ~1s.

## Coverage map
- Covered (need tests): src/lib/lazyWithRetry.ts, src/services/ocrService.ts.
- Excluded (vitest+sonar): src/components/**, src/pages/**, src/hooks/use*.tsx, src/App.tsx.
