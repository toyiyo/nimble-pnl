# Design: Decommission the Weekly Brief and the Ops Inbox

Date: 2026-09-15
Branch: `claude/inspiring-archimedes-2fdn6p`

## Goal

Delete the Weekly Brief feature and the Ops Inbox feature from the product.
Delete the UI, the hooks, the edge functions, the AI tools, the cron jobs,
the queues, and the tables.

## Evidence from PostHog

The pages send no custom events. `$pageview` on the two routes is the only
usage signal. Data for the last 365 days:

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
| Page | `src/pages/OpsInbox.tsx` | Delete file |
| Page | `src/pages/WeeklyBrief.tsx` | Delete file |
| Hook | `src/hooks/useOpsInbox.ts` | Delete file |
| Hook | `src/hooks/useWeeklyBrief.ts` | Delete file |
| Hook | `src/hooks/useNotificationPreferences.ts` | Delete file |
| Dashboard cards | `src/pages/Index.tsx:1259`–`1290` | Delete block |
| Dashboard count hook | `src/pages/Index.tsx:49`, `src/pages/Index.tsx:304` | Delete import and call |
| Sidebar entries | `src/components/AppSidebar.nav.data.ts:64`, `src/components/AppSidebar.nav.data.ts:66` | Delete rows |
| Sidebar feature map | `src/components/AppSidebar.tsx:48`–`49` | Delete rows |
| Sidebar comment | `src/components/AppSidebar.nav.ts:147` | Update comment |
| Subscription features `ops_inbox`, `weekly_brief` | `src/lib/subscriptionPlans.ts:264`–`285` | Delete entries |
| Permission area keys | `src/lib/permissions/areas.ts:43`, `src/lib/permissions/areas.ts:45`, `src/lib/permissions/areas.ts:222`–`236` | Delete entries |
| Permission area data | `src/lib/permissions/areaData.ts:44`, `src/lib/permissions/areaData.ts:46` | Delete rows |
| Route→area map | `src/lib/permissions/routeAreas.ts:19` | Update map and comment |
| Weekly-brief email section | `src/components/NotificationSettings.tsx:7`, `src/components/NotificationSettings.tsx:18`–`19`, `src/components/NotificationSettings.tsx:152`–`171` | Delete section |
| Comment on excluded key | `src/lib/notificationTypes.ts:10`–`11` | Delete comment |
| Generated DB types | `src/integrations/supabase/types.ts`, `src/types/supabase.ts` | Delete the type entries for the dropped tables and functions |

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
| Handler `executeGetProactiveInsights` | `supabase/functions/ai-execute-tool/index.ts:3239`–`3306` | Delete function and its dispatch case |
| Handler for `resolve_inbox_item` | `supabase/functions/ai-execute-tool/index.ts:3639`–`3686` | Delete function and its dispatch case |

`get_proactive_insights` reads only `ops_inbox_item` and `weekly_brief`
(`supabase/functions/ai-execute-tool/index.ts:3248`, `:3273`). It has no
purpose after the drop. The owner approved the deletion of both tools.

The functions `compute_weekly_variances`, `detect_uncategorized_backlog`,
`detect_metric_anomalies`, and `detect_reconciliation_gaps` have exactly
one caller: `supabase/functions/generate-weekly-brief-worker/index.ts:137`,
`:147`, `:151`, `:155`. `compute_daily_variances` has no caller in
`src/` or `supabase/functions/` (only generated type entries). All five
become orphans and the migration drops them.

### Database (one new migration)

Order matters. `role_areas.area_key` references `area_catalog(area_key)`
with RESTRICT (`supabase/migrations/20260805120000_page_areas.sql:11`–`12`).
Delete the `role_areas` rows before the `area_catalog` rows.

1. Unschedule cron jobs, each wrapped in an exception-safe block:
   - `enqueue-weekly-briefs` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:256`)
   - `process-weekly-brief-queue` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:263`)
   - `generate-weekly-briefs` (legacy name, `supabase/migrations/20260214100000_ai_operator.sql:725`)
2. Drop functions:
   - `enqueue_weekly_brief_jobs()` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:59`)
   - `process_weekly_brief_queue()` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:130`)
   - `compute_daily_variances`, `compute_weekly_variances` (`supabase/migrations/20260214100000_ai_operator.sql:156`, `:312`)
   - `detect_uncategorized_backlog`, `detect_metric_anomalies`, `detect_reconciliation_gaps` (`supabase/migrations/20260214100000_ai_operator.sql:481`, `:555`, `:614`)
3. Drop pgmq queues `weekly_brief_jobs` and `weekly_brief_dead_letter`
   (`supabase/migrations/20260216200000_weekly_brief_queue.sql:17`–`18`).
4. Drop tables:
   - `weekly_brief_job_log` (`supabase/migrations/20260216200000_weekly_brief_queue.sql:24`)
   - `weekly_brief` (`supabase/migrations/20260214100000_ai_operator.sql:76`)
   - `ops_inbox_item` (`supabase/migrations/20260214100000_ai_operator.sql:10`)
   - `notification_preferences` (`supabase/migrations/20260214100000_ai_operator.sql:107`)
5. Re-create `has_subscription_feature()` without the `ops_inbox` and
   `weekly_brief` branches
   (`supabase/migrations/20260217210000_gate_ops_weekly_brief_pro.sql:79`–`80`).
   Update the function comment
   (`supabase/migrations/20260217210000_gate_ops_weekly_brief_pro.sql:103`–`111`).
6. Delete the permission rows: first `role_areas` rows with
   `area_key IN ('ops_inbox','weekly_brief')`, then the two
   `area_catalog` rows
   (`supabase/migrations/20260805120000_page_areas.sql:40`–`41`).

`notification_preferences` serves only this feature pair. Its columns are
`weekly_brief_email`, `brief_send_time`, `inbox_digest_email`
(`supabase/migrations/20260214100000_ai_operator.sql:111`–`113`). Its only
readers are `src/hooks/useNotificationPreferences.ts` and
`supabase/functions/send-weekly-brief-email/index.ts`, plus generated
types. Both readers get deleted, so the table drops with them.

`pgmq_delete_message()`
(`supabase/migrations/20260216200000_weekly_brief_queue.sql:229`) stays if
another caller exists; the build phase checks and drops it only when
`process_weekly_brief_queue` is its sole caller.

### Tests

| Test | Action |
|---|---|
| `tests/unit/useOpsInbox.test.ts` | Delete |
| `tests/unit/useWeeklyBrief.test.ts` | Delete |
| `tests/unit/useNotificationPreferences.test.ts` | Delete |
| `tests/unit/NotificationSettings.test.tsx` | Update: delete the weekly-brief cases |
| `tests/unit/notificationTypes.test.ts` | Update: delete the weekly-brief references |
| `tests/unit/subscriptionPlans.test.ts` | Update: delete the two feature keys |
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
`src/content/help/settings-and-integrations/ai-chef-assistant.md`,
`src/content/help/getting-started/dashboard-overview.md`.

## Out of scope

- The AI operator chat itself and its other tools stay.
- `unified_sales`, subscription tiers, and other Pro features stay.
- The `eslint.config.js` reference is a generic glob; check during build
  and update only if it names a deleted path.

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
