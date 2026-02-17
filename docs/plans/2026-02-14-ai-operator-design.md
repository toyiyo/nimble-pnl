# AI Operator: Chat Upgrade + Daily Brief + Ops Inbox

**Date**: 2026-02-14
**Approach**: A — Data layer first, then chat upgrade, then UX surfaces
**Based on**: Deep research report (`Always-On Restaurant Operator for EasyShiftHQ`)

## Goals

1. **Upgrade AI Chat** — Evidence-backed answers, proactive insights, action execution with approval
2. **Weekly Brief** — Monday morning email + dedicated page with key numbers, variances, narrative, top actions
3. **Ops Inbox** — Prioritized task queue surfacing uncategorized transactions, anomalies, reconciliation gaps

## Constraints

- Keep existing pg_cron + Edge Function + trigger infrastructure (no pgmq)
- LLM narrates and drafts, never computes — all numbers from SQL
- Evidence inline as jsonb for v1 (no separate `evidence_ref` table)
- Chat-based approval for actions (no Approval Drawer UI for v1)
- Email via Resend (HTTP API, no SMTP)

---

## Section 1: Data Layer

### New Tables

#### `ops_inbox_item`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | Multi-tenancy |
| `title` | text | e.g. "23 uncategorized bank transactions" |
| `description` | text | Detail / context |
| `kind` | text | `uncategorized_txn`, `uncategorized_pos`, `anomaly`, `reconciliation`, `recommendation` |
| `priority` | int | 1 (critical) to 5 (low) |
| `status` | text | `open`, `snoozed`, `done`, `dismissed` |
| `snoozed_until` | timestamptz | When to resurface |
| `due_at` | timestamptz | Optional deadline |
| `linked_entity_type` | text | `bank_transaction`, `unified_sale`, `daily_pnl`, etc. |
| `linked_entity_id` | uuid | FK to specific record |
| `evidence_json` | jsonb | Array of `{table, id, summary}` |
| `meta` | jsonb | Flexible payload (counts, amounts, percentages) |
| `created_by` | text | `system`, `variance_detector`, `reconciliation_check`, `user` |
| `created_at` | timestamptz | |
| `resolved_at` | timestamptz | When marked done/dismissed |
| `resolved_by` | uuid | Who resolved it |

#### `weekly_brief`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `brief_week_end` | date | The Sunday ending the week this brief covers |
| `metrics_json` | jsonb | Key numbers: weekly revenue, food cost, labor cost, prime cost, etc. |
| `comparisons_json` | jsonb | Deltas: vs prior week, 4-week avg |
| `variances_json` | jsonb | Array of `{metric, delta, direction, driver, evidence}` |
| `inbox_summary_json` | jsonb | `{open_count, critical_count, top_items}` |
| `recommendations_json` | jsonb | Array of `{title, body, impact, effort, evidence}` |
| `narrative` | text | LLM-generated summary grounded in computed data |
| `computed_at` | timestamptz | |
| `email_sent_at` | timestamptz | |

#### `notification_preferences`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `restaurant_id` | uuid FK | |
| `weekly_brief_email` | boolean default true | Opt-out toggle |
| `brief_send_time` | time default '07:00' | Preferred delivery time |
| `inbox_digest_email` | boolean default false | Future |

### Design Decisions

- Evidence stored inline as jsonb (no separate `evidence_ref` table for v1)
- Variances computed in SQL, not by LLM
- `weekly_brief` is a materialized row, not computed on page load
- RLS follows existing `restaurant_id` + `user_restaurants` pattern

---

## Section 2: Variance Engine + Anomaly Detectors

### SQL Functions

**`compute_weekly_variances(p_restaurant_id uuid, p_week_end date)`** returns jsonb

Aggregates `daily_pnl` for the 7-day week ending on `p_week_end` and compares against:
- Prior week (7 days before)
- 4-week rolling average (28 days before, divided by 4)

Returns array of variance objects with metric, value, delta, delta_pct, direction, flag.

**Flagging thresholds (v1 hardcoded)**:
- Revenue drop > 15% vs 4-week avg: `warning`
- Food cost % > 33%: `warning`, > 38%: `critical`
- Labor cost % > 35%: `warning`, > 40%: `critical`
- Prime cost % > 65%: `warning`, > 70%: `critical`

### Anomaly Detectors

**`detect_uncategorized_backlog(p_restaurant_id)`** creates inbox items:
- Counts uncategorized bank transactions + POS sales
- Priority: >50 = critical, >20 = high, else medium
- Upserts to avoid duplicates

**`detect_reconciliation_gaps(p_restaurant_id, p_date)`** creates inbox items:
- Finds bank deposits with no matching POS daily total
- Finds days with POS sales but no bank deposit

**`detect_metric_anomalies(p_restaurant_id, p_date)`** creates inbox items:
- Any metric flagged `warning` or `critical` creates an item
- Deduplicates: skips if open item exists for same metric+date

### Inbox Lifecycle

`open` -> `snoozed` (resurfaces at `snoozed_until`) -> `done` / `dismissed`

Auto-resolution: cron checks if underlying condition cleared (e.g., all transactions categorized) and marks `done` with `resolved_by = 'system'`.

---

## Section 3: Weekly Brief Generation + Email

### Edge Function: `generate-weekly-brief`

Triggered by pg_cron every Monday at 6:00 AM UTC.

Flow per restaurant (batched, max 10 per run):
1. Call `compute_weekly_variances(restaurant_id, last_sunday)` — aggregates prior week (Mon–Sun)
2. Run all anomaly detectors
3. Query `ops_inbox_item` for open items summary
4. Rank top 3 recommendations (highest impact anomalies)
5. Call LLM to generate narrative (3-4 sentences, grounded in computed data)
6. Insert `weekly_brief` row
7. Send email to opted-in users via Resend

### LLM Narrative Prompt

```text
You are a restaurant financial analyst. Summarize this week's performance
in 3-4 sentences. ONLY reference the numbers provided below. Do not
invent or estimate any figures.

Metrics: {metrics_json}
Variances: {variances_json}
Open issues: {inbox_summary_json}

Write in a direct, professional tone. Lead with the most important change.
```

### Email

- Provider: Resend (HTTP API)
- HTML template: key numbers grid, delta badges, narrative, top 3 inbox items, CTA to brief page
- Failure: log error, don't retry (brief viewable in-app)

### Brief Page: `/weekly-brief`

- Week picker (defaults to last complete week, browsable ±7 days)
- Metrics row: 4-6 cards with delta indicators (vs prior week)
- What Changed: variance cards with navigation links
- Narrative: LLM-generated paragraph
- Top Actions: 3 recommendation cards with "Take action" buttons
- Open Issues: count badge linking to `/ops-inbox`

### Settings

- Added to existing Settings page
- Toggle: "Receive weekly brief email" (default on)
- Time picker: preferred send time (future enhancement for per-user scheduling)

---

## Section 4: Ops Inbox Page

### Route: `/ops-inbox`

- Filter tabs: All Open | Critical | Snoozed | Resolved
- Sort: Priority (default), Date created, Due date
- Virtualized list with memoized row components

### Inbox Item Card

- Priority badge (color-coded)
- Title + description (2 lines, expandable)
- Evidence links (clickable, navigate to source)
- Actions: View Details | Snooze (1h, tomorrow, next week, custom) | Dismiss | Ask AI

### Hook: `useOpsInbox`

```typescript
useOpsInbox(restaurantId, { status?, kind?, priority?, limit? })
```

React Query, 30s staleTime. Mutations: updateStatus, snoozeItem, dismissItem.

### Key Interactions

- **Ask AI**: opens chat panel with pre-filled context from the inbox item
- **Auto-resolution**: cron checks and marks items done when condition clears
- **Dashboard badge**: small count badge on main dashboard linking to `/ops-inbox`

---

## Section 5: AI Chat Upgrade

### 5A: Evidence-Backed Answers

- `ai-execute-tool` upgraded: every tool handler returns `evidence` array alongside data
- System prompt instructs model to cite evidence: "Based on [label] - [figure]"
- No new UI component — evidence cited inline in markdown responses

### 5B: Proactive Insights

New tool: `get_proactive_insights`
- Queries top 5 open `ops_inbox_item` by priority
- Queries latest `weekly_brief`
- Returns structured payload

Auto-injection: system prompt tells AI to call this tool at session start and mention critical/high items before responding to user's question.

### 5C: Action Execution

New tools (owner/manager only):

| Tool | Action | Approval |
|------|--------|----------|
| `batch_categorize_transactions` | Categorize bank transactions | Preview -> confirm in chat |
| `batch_categorize_pos_sales` | Categorize POS sales | Preview -> confirm in chat |
| `link_invoice_to_transaction` | Link invoice to bank txn | Preview -> confirm in chat |
| `create_categorization_rule` | Create auto-categorization rule | Preview -> confirm in chat |
| `resolve_inbox_item` | Mark inbox item done/dismissed | Direct (low risk) |

**Preview-first pattern**:
1. AI calls tool with `preview: true` -> gets preview of changes
2. AI presents preview to user in chat
3. User confirms ("yes" / "go ahead")
4. AI calls tool with `preview: false, confirmed: true`
5. Tool executes and returns result with evidence
6. AI confirms completion

Tool rejects `confirmed: true` without prior `preview: true` in same session.

### Design Decisions

- Chat-based approval, not Approval Drawer UI (simpler for v1)
- Evidence as inline text, not separate panel
- Proactive insights via system prompt injection at session start
- All action tools are preview-first with explicit user confirmation
