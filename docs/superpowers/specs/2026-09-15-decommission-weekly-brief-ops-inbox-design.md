# Design: Decommission the Weekly Brief and the Ops Inbox

Date: 2026-09-15
Branch: `claude/inspiring-archimedes-2fdn6p`

## Goal

Delete the Weekly Brief feature and the Ops Inbox feature from the product.
Delete the UI, the hooks, the edge functions, the AI tools, the cron jobs,
the queues, and the tables.

## Evidence from PostHog

The pages send no custom events: a grep for `posthog` and `capture(` in
`src/pages/OpsInbox.tsx`, `src/pages/WeeklyBrief.tsx`,
`src/hooks/useOpsInbox.ts`, and `src/hooks/useWeeklyBrief.ts` finds zero
matches. `$pageview` on the two routes is the only usage signal. Data for
the last 365 days:

| Path | Pageviews | Unique persons | Last visit |
|---|---|---|---|
| `/weekly-brief` | 16 | 3 | 2026-04-13 |
| `/ops-inbox` | 3 | 3 | 2026-07-14 |

15 of 19 pageviews came from development hosts (localhost, Lovable
previews, `stable.easyshifthq.com`). One pageview came from production
(`app.easyshifthq.com`). The person records point to the owner account.
No customer used these features. The owner confirmed this conclusion and
approved a full decommission, with a full drop of the database objects.

## Decision

Full removal in one PR:

1. Delete the frontend pages, routes, hooks, and navigation entries.
2. Delete the three edge functions and the two AI operator tools.
3. Add one decommission migration. It drops the cron jobs, the pgmq
   queues, the SQL functions, and the four tables.
4. Delete or update the tests and the help content.

Rollback path: revert the PR. The dropped data is not recoverable. The
owner accepted this because the tables hold only the owner's test data.

## Inventory

### Frontend

| Item | Location | Action |
|---|---|---|
| Route `/ops-inbox` | `src/App.tsx:428` | Delete |
| Route `/weekly-brief` | `src/App.tsx:430` | Delete |
| Page imports | `src/App.tsx:86`, `src/App.tsx:88` | Delete static imports |
| Page | `src/pages/OpsInbox.tsx` | Delete file |
| Page | `src/pages/WeeklyBrief.tsx` | Delete file |
| Hook | `src/hooks/useOpsInbox.ts` | Delete file |
| Hook | `src/hooks/useWeeklyBrief.ts` | Delete file |
| Hook | `src/hooks/useNotificationPreferences.ts` | Delete file |
| Dashboard cards | `src/pages/Index.tsx:1258`–`1295` (comment `{/* AI Operator — Pro only */}` at `:1258`, closing `)}` at `:1295`) | Delete block |
| Dashboard count hook | `src/pages/Index.tsx:49`, `src/pages/Index.tsx:304` | Delete import and call |
| Sidebar entries | `src/components/AppSidebar.nav.data.ts:64`, `src/components/AppSidebar.nav.data.ts:66` | Delete rows |
| Sidebar icon imports `Inbox`, `Newspaper` | `src/components/AppSidebar.nav.data.ts:37`–`38` | Delete: no other use after the row deletions |
| Sidebar feature map | `src/components/AppSidebar.tsx:48`–`49` | Delete rows |
| Sidebar comment | `src/components/AppSidebar.nav.ts:147` | Update comment |
| Subscription features `ops_inbox`, `weekly_brief` | `src/lib/subscriptionPlans.ts:264`–`274`, `:275`–`285` | Delete entries |
| Permission area keys | `src/lib/permissions/areas.ts:43`, `src/lib/permissions/areas.ts:45` | Delete union entries |
| Permission capability entries | `src/lib/permissions/areas.ts:222`–`225` (`ops_inbox`), `:230`–`233` (`weekly_brief`) only; keep `reviews` at `:226`–`229` | Delete the two entries |
| Capability-map header comment | `src/lib/permissions/areas.ts:197`–`198` | Update comment |
| Permission area data | `src/lib/permissions/areaData.ts:44`, `src/lib/permissions/areaData.ts:46` | Delete rows |
| Route→area map | `src/lib/permissions/routeAreas.ts:19` | Update comment; the map derives from the catalog |
| Weekly-brief email card | `src/components/NotificationSettings.tsx:145`–`176` (`<Card>` at `:145`, `</Card>` at `:176`) | Delete the whole card |
| Notification page description | `src/components/NotificationSettings.tsx:62`–`65` | Rewrite: it promises "your weekly performance digest" |
| Icon import `Newspaper` | `src/components/NotificationSettings.tsx:5` | Delete: no other use |
| Hook import and call | `src/components/NotificationSettings.tsx:7`, `:18`–`19` | Delete |
| Comment on excluded key | `src/lib/notificationTypes.ts:10`–`11` | Delete comment |
| ESLint exemption row | `eslint.config.js:238` (`src/pages/WeeklyBrief.tsx`) | Delete row |
| Generated DB types | `src/integrations/supabase/types.ts`, `src/types/supabase.ts` | Delete the entries for the dropped tables and functions, `pgmq_delete_message` included (`src/types/supabase.ts:11435`, `src/integrations/supabase/types.ts:11972`) |

The hooks read the tables through an `as any` cast
(`src/hooks/useOpsInbox.ts:7`, `src/hooks/useWeeklyBrief.ts:7`), so no
other module imports these table types directly.

### Edge functions and AI tools

| Item | Location | Action |
|---|---|---|
| `generate-weekly-brief` | `supabase/functions/generate-weekly-brief/` | Delete directory |
| `generate-weekly-brief-worker` | `supabase/functions/generate-weekly-brief-worker/` | Delete directory |
| `send-weekly-brief-email` | `supabase/functions/send-weekly-brief-email/` | Delete directory |
| AI tool `get_proactive_insights` | `supabase/functions/_shared/tools-registry.ts:275` | Delete tool definition |
| AI tool `resolve_inbox_item` | `supabase/functions/_shared/tools-registry.ts:822` | Delete tool definition |
| Allow-list strings | `supabase/functions/_shared/tools-registry.ts:904` (`basicTools`), `:929` (`managerOwnerTools`) | Delete the two strings |
| Handler `executeGetProactiveInsights` | `supabase/functions/ai-execute-tool/index.ts:3239`–`3308` | Delete function and its dispatch case (`:3860`) |
| Handler `executeResolveInboxItem` | `supabase/functions/ai-execute-tool/index.ts:3626`–`3689` (doc comment at `:3626`–`3629`) | Delete function and its dispatch case (`:3872`) |
| "PROACTIVE INSIGHTS" prompt block | `supabase/functions/ai-chat-stream/index.ts:588`–`591` | Delete block: it instructs a call to `get_proactive_insights` |

`get_proactive_insights` reads only `ops_inbox_item` and `weekly_brief`
(`supabase/functions/ai-execute-tool/index.ts:3248`, `:3273`). It has no
purpose after the drop. The owner approved the deletion of both tools.

The functions `compute_weekly_variances`, `detect_uncategorized_backlog`,
`detect_metric_anomalies`, and `detect_reconciliation_gaps` have exactly
one TypeScript caller: `supabase/functions/generate-weekly-brief-worker/index.ts:137`,
`:147`, `:151`, `:155`. `compute_daily_variances` has no caller in
`src/` or `supabase/functions/` (repo-wide grep; only generated type
entries match). Its one SQL caller is `detect_metric_anomalies`
(`supabase/migrations/20260214100000_ai_operator.sql:568`), which also
drops. All five become orphans and the migration drops them.

### Database (one new migration)

Order matters. `role_areas.area_key` references `area_catalog(area_key)`
with RESTRICT (`supabase/migrations/20260805120000_page_areas.sql:11`–`12`).
Delete the `role_areas` rows before the `area_catalog` rows.

1. Unschedule cron jobs, each wrapped in an exception-safe block:
   - `enqueue-weekly-briefs` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:256`)
   - `process-weekly-brief-queue` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:263`)
   - `generate-weekly-briefs` (legacy name, `supabase/migrations/20260214100000_ai_operator.sql:725`)
2. Drop functions, each with `IF EXISTS`:
   - `enqueue_weekly_brief_jobs()` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:59`)
   - `process_weekly_brief_queue()` (first created at `supabase/migrations/20260216200000_weekly_brief_queue.sql:130`; live definition in `supabase/migrations/20260217031454_9c95bf26-eb62-46f0-bfd1-6815d60f8c63.sql`)
   - `pgmq_delete_message()` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:229`). Its only callers are `supabase/functions/generate-weekly-brief-worker/index.ts:119` and `:315`, and the worker gets deleted. Keep no orphaned `SECURITY DEFINER` RPC.
   - `compute_daily_variances`, `compute_weekly_variances` (`supabase/migrations/20260214100000_ai_operator.sql:156`, `:312`)
   - `detect_uncategorized_backlog`, `detect_metric_anomalies`, `detect_reconciliation_gaps` (`supabase/migrations/20260214100000_ai_operator.sql:481`, `:555`, `:614`)
3. Drop pgmq queues `weekly_brief_jobs` and `weekly_brief_dead_letter`
   (`supabase/migrations/20260216200000_weekly_brief_queue.sql:17`–`18`).
   `pgmq.drop_queue` raises on a missing queue: wrap each drop in an
   exception-safe DO block, matching the cron pattern at
   `supabase/migrations/20260216200000_weekly_brief_queue.sql:248`–`253`.
   The `pgmq` extension stays installed after the queue drops; no other
   code uses it, and an extension drop is out of scope for this PR.
4. Drop tables:
   - `weekly_brief_job_log` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:24`)
   - `weekly_brief` (`supabase/migrations/20260214100000_ai_operator.sql:76`)
   - `ops_inbox_item` (`supabase/migrations/20260214100000_ai_operator.sql:10`)
   - `notification_preferences` (`supabase/migrations/20260214100000_ai_operator.sql:107`)
5. Re-create `has_subscription_feature()` without the `ops_inbox` and
   `weekly_brief` branches
   (`supabase/migrations/20260217210000_gate_ops_weekly_brief_pro.sql:79`–`80`).
   Update the function comment
   (`supabase/migrations/20260217210000_gate_ops_weekly_brief_pro.sql:103`–`118`).
6. Delete the permission rows: first `role_areas` rows with
   `area_key IN ('ops_inbox','weekly_brief')`, then the two
   `area_catalog` rows
   (`supabase/migrations/20260805120000_page_areas.sql:40`–`41`).
   The trigger `role_areas_block_builtin_mutation`
   (`supabase/migrations/20260730100000_roles_and_areas_tables.sql:462`–`465`)
   raises `42501` on DELETE of a builtin-role row. Production state was
   not checked, so disable the trigger before the DELETE and re-enable
   it after, per the precedent at
   `supabase/migrations/20260805120000_page_areas.sql:15`.
   Update the `area_catalog.area_key` comment: it says "33 keys"
   (`supabase/migrations/20260805120000_page_areas.sql:413`–`414`) and the
   count becomes 31.

History note: `supabase/migrations/20260217031811_89b9e8d7-7e93-47d3-8507-e51025bb2597.sql`
widened `ops_inbox_item_kind_check` with `'weekly_brief_failure'`. The
constraint drops with the table; no migration change is needed.

`notification_preferences` serves only this feature pair. Its columns are
`weekly_brief_email`, `brief_send_time`, `inbox_digest_email`
(`supabase/migrations/20260214100000_ai_operator.sql:111`–`113`). Its only
readers are `src/hooks/useNotificationPreferences.ts` and
`supabase/functions/send-weekly-brief-email/index.ts`, plus generated
types. Both readers get deleted, so the table drops with them.

### Tests

| Test | Action |
|---|---|
| `tests/unit/useOpsInbox.test.ts` | Delete |
| `tests/unit/useWeeklyBrief.test.ts` | Delete |
| `tests/unit/useNotificationPreferences.test.ts` | Delete |
| `tests/unit/NotificationSettings.test.tsx` | Update: delete the weekly-brief cases |
| `tests/unit/notificationTypes.test.ts` | Update: delete the weekly-brief references |
| `tests/unit/subscriptionPlans.test.ts` | Update: delete the two feature keys |
| `tests/unit/areas.test.ts:103` | Update: `toHaveLength(33)` becomes `toHaveLength(31)` |
| `tests/unit/areas.test.ts`, `tests/unit/routeAreas.test.ts`, `tests/unit/areaCoverageStrips.test.tsx` | Update: delete the two area keys where referenced |
| `supabase/tests/32_weekly_brief_queue.sql` | Delete |
| `supabase/tests/30_ai_operator.sql` | Update or delete: it tests the dropped tables and functions |
| `supabase/tests/roles_seed_test.sql`, `supabase/tests/page_areas_catalog_test.sql`, `supabase/tests/20260129000000_subscription_system.sql` | Update: adjust counts and key lists |

No E2E spec references these pages (checked `tests/e2e/` for
`weekly-brief`, `ops-inbox`, `WeeklyBrief`, `OpsInbox`: zero matches).
E2E gate position: this change deletes routes and adds no new flow. The
existing E2E suite must stay green, which proves the app boots and
navigates without the deleted routes. No new E2E spec is required.

### Help content

Delete `src/content/help/financials-and-accounting/weekly-brief-performance-digest.md`
and `src/content/help/financials-and-accounting/ops-inbox-triage-alerts.md`.
Update the files that link to them:
`src/content/help/settings-and-integrations/notification-and-email-preferences.md`,
`src/content/help/getting-started/dashboard-overview.md`,
`src/content/help/getting-started/roles-and-permissions.md`,
`src/content/help/getting-started/subscription-plans.md`,
`src/content/help/financials-and-accounting/budget-break-even.md`,
`src/content/help/financials-and-accounting/reports-pnl-recipe-variance-pricing.md`,
`src/content/help/settings-and-integrations/ai-chef-assistant.md`.

## Out of scope

- The AI operator chat itself and its other tools stay.
- `unified_sales`, subscription tiers, and other Pro features stay.
- The `pgmq` extension stays installed; an extension drop is a separate
  decision.

## Decided trade-offs

- Dropped data is not recoverable after the migration runs in production.
  Accepted: the tables hold only the owner's test data (PostHog evidence
  above).
- The generated Supabase types get a hand edit instead of a full
  regeneration. Accepted: the remote session cannot reach production to
  regenerate, and the edit only deletes entries.

## Environment notes for this session

- `cdn.sheetjs.com` is blocked by the egress policy. `npm install` fails
  on the `xlsx` tarball pin (`package.json:130`). Local verification uses
  registry `xlsx@0.18.5` as a stand-in; `package.json` and
  `package-lock.json` stay unchanged in git. CI resolves the real pin.
- `supabase-prod` MCP tools are not registered in this session, so the
  production `notification_preferences` rows were not counted. The
  PostHog evidence and the owner's confirmation stand alone.
