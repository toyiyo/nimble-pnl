# Plan: Decommission the Weekly Brief and the Ops Inbox

Design: `docs/superpowers/specs/2026-09-15-decommission-weekly-brief-ops-inbox-design.md`
Branch: `claude/inspiring-archimedes-2fdn6p`

Every task ends with a green check and a commit. The task list keeps the
branch buildable after each commit. This change deletes code, so the
verification per task is: the named tests pass, `npm run typecheck`
passes, and `npm run lint` passes on the changed files.

## Task 1 — Delete the pages, the routes, and their hooks

- Delete `src/pages/OpsInbox.tsx` and `src/pages/WeeklyBrief.tsx`.
- Delete `src/hooks/useOpsInbox.ts` and `src/hooks/useWeeklyBrief.ts`.
- In `src/App.tsx`: delete the imports (`:86`, `:88`) and the routes
  (`:428`, `:430`).
- In `src/pages/Index.tsx`: delete the import (`:49`), the call (`:304`),
  and the block `:1258`–`:1295`.
- In `src/components/AppSidebar.nav.data.ts`: delete rows `:64`, `:66`
  and the icon imports `Inbox`, `Newspaper` (`:37`–`38`).
- In `src/components/AppSidebar.tsx`: delete the map rows `:48`–`49`.
- In `src/components/AppSidebar.nav.ts`: update the comment (`:147`).
- In `eslint.config.js`: delete row `:238`.
- Delete `tests/unit/useOpsInbox.test.ts` and
  `tests/unit/useWeeklyBrief.test.ts`.
- Check: `npm run test -- tests/unit` passes; typecheck passes.

## Task 2 — Delete the notification-preferences surface

- Delete `src/hooks/useNotificationPreferences.ts` and
  `tests/unit/useNotificationPreferences.test.ts`.
- In `src/components/NotificationSettings.tsx`: delete the card
  `:145`–`176`, the imports (`:5` `Newspaper`, `:7` hook), the hook call
  `:18`–`19`, and rewrite the description `:62`–`65`.
- In `src/lib/notificationTypes.ts`: delete the comment `:10`–`11`.
- Update `tests/unit/NotificationSettings.test.tsx`: delete the
  weekly-brief cases.
- Update `tests/unit/notificationTypes.test.ts` if it names the key.
- Check: the two updated test files pass; typecheck passes.

## Task 3 — Delete the feature keys and the permission areas

- In `src/lib/subscriptionPlans.ts`: delete the `ops_inbox` entry
  (`:264`–`274`) and the `weekly_brief` entry (`:275`–`285`).
- In `src/lib/permissions/areas.ts`: delete the union entries (`:43`,
  `:45`), the capability entries `ops_inbox` (`:222`–`225`) and
  `weekly_brief` (`:230`–`233`), and update the comments (`:197`–`198`).
  Keep the `reviews` entry (`:226`–`229`).
- In `src/lib/permissions/areaData.ts`: delete rows `:44`, `:46`.
- In `src/lib/permissions/routeAreas.ts`: update the comment (`:19`).
- Update `tests/unit/areas.test.ts` (`:103`: 33 becomes 31; delete key
  references), `tests/unit/subscriptionPlans.test.ts`, and
  `tests/unit/routeAreas.test.ts` / `tests/unit/areaCoverageStrips.test.tsx`
  where the keys appear.
- Check: the updated test files pass; typecheck passes.

## Task 4 — Delete the edge functions and the AI tools

- Delete the directories `supabase/functions/generate-weekly-brief/`,
  `supabase/functions/generate-weekly-brief-worker/`,
  `supabase/functions/send-weekly-brief-email/`.
- In `supabase/functions/_shared/tools-registry.ts`: delete the tool
  definitions (`:275`, `:822`) and the allow-list strings (`:904`,
  `:929`).
- In `supabase/functions/ai-execute-tool/index.ts`: delete
  `executeGetProactiveInsights` (`:3239`–`3308`),
  `executeResolveInboxItem` (`:3626`–`3689`), and the dispatch cases
  (`:3860`, `:3872`).
- In `supabase/functions/ai-chat-stream/index.ts`: delete the
  "PROACTIVE INSIGHTS" block (`:588`–`591`).
- Check: `npm run typecheck` passes; grep finds no reference to the two
  tool names outside git history.

## Task 5 — Write the decommission migration

File: `supabase/migrations/<timestamp>_decommission_weekly_brief_ops_inbox.sql`.
Follow the design's ordered steps:

1. Unschedule `enqueue-weekly-briefs`, `process-weekly-brief-queue`,
   `generate-weekly-briefs` in exception-safe DO blocks.
2. Drop the functions with `IF EXISTS`: `enqueue_weekly_brief_jobs`,
   `process_weekly_brief_queue`, `pgmq_delete_message`,
   `compute_daily_variances`, `compute_weekly_variances`,
   `detect_uncategorized_backlog`, `detect_metric_anomalies`,
   `detect_reconciliation_gaps`.
3. Drop the pgmq queues `weekly_brief_jobs`, `weekly_brief_dead_letter`
   in exception-safe DO blocks.
4. Drop the tables with `IF EXISTS`: `weekly_brief_job_log`,
   `weekly_brief`, `ops_inbox_item`, `notification_preferences`.
5. Re-create `has_subscription_feature()` without the two branches;
   update its comment.
6. Disable `role_areas_block_builtin_mutation`, delete the `role_areas`
   rows for the two keys, re-enable the trigger, delete the two
   `area_catalog` rows, update the "33 keys" comment to 31.
- Update the pgTAP tests: delete
  `supabase/tests/32_weekly_brief_queue.sql`; update or delete
  `supabase/tests/30_ai_operator.sql`; update
  `supabase/tests/roles_seed_test.sql`,
  `supabase/tests/page_areas_catalog_test.sql`,
  `supabase/tests/20260129000000_subscription_system.sql`.
- Check: `npm run db:reset` succeeds; `npm run test:db` passes.

## Task 6 — Clean the generated types

- In `src/integrations/supabase/types.ts` and `src/types/supabase.ts`:
  delete the entries for `weekly_brief`, `weekly_brief_job_log`,
  `ops_inbox_item`, `notification_preferences`,
  `enqueue_weekly_brief_jobs`, `process_weekly_brief_queue`,
  `pgmq_delete_message`, `compute_daily_variances`,
  `compute_weekly_variances`, `detect_uncategorized_backlog`,
  `detect_metric_anomalies`, `detect_reconciliation_gaps`.
- Check: `npm run typecheck` passes; `npm run build` passes.

## Task 7 — Delete the help content

- Delete
  `src/content/help/financials-and-accounting/weekly-brief-performance-digest.md`
  and `src/content/help/financials-and-accounting/ops-inbox-triage-alerts.md`.
- Update the seven linking files listed in the design.
- Check: grep in `src/content/help/` finds no link to the two slugs.

## Task 8 — Residual sweep

- Grep the repo for `weekly_brief`, `ops_inbox`, `weekly-brief`,
  `ops-inbox`, `WeeklyBrief`, `OpsInbox`, `get_proactive_insights`,
  `resolve_inbox_item`, `pgmq_delete_message`,
  `notification_preferences`.
- Allowed leftovers: git history, old migrations, old design docs and
  plans, `memory/lessons.md`, this design and plan pair.
- Fix every other hit.
- Check: `npm run test`, `npm run typecheck`, `npm run lint`,
  `npm run build` all pass.

## Dependencies

Tasks 1–4 are independent of each other. Task 5 is independent of 1–4.
Task 6 follows Task 5 (same object list). Tasks 7–8 come last.

## Environment notes

- Local verification uses registry `xlsx@0.18.5` because the egress
  policy blocks `cdn.sheetjs.com`. Keep `package.json` and
  `package-lock.json` unchanged.
- Docker exists in this session; `npm run db:reset` and
  `npm run test:db` run locally.
- E2E: no spec references the deleted pages. The CI E2E run is the
  gate; no new spec is required (design, "Tests" section).
