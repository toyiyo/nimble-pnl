# Gusto Payroll Integration — Design Document

**Date**: 2026-02-05
**Branch**: `feature/gustopayroll`
**Status**: Approved

## Goal

Complete the Gusto Embedded Payroll integration so that:
1. Managers can invite employees to onboard via Gusto's embedded self-service flow
2. Employees clock hours in our system, which we sync to Gusto for payroll processing
3. Existing employees can be mapped to their Gusto counterparts
4. Webhooks keep both systems in sync
5. Everything works with AND without Gusto connected

## Decisions

| Decision | Choice |
|----------|--------|
| Gusto onboarding trigger | Inline on employee row (per-employee action) |
| Existing employee mapping | Auto-match by email + manual confirm dialog |
| Mapping UI location | Banner/section on Gusto Payroll page |
| Prepare payroll UX | Preview summary, then sync, then Gusto iframe |
| Unified payroll page | Single `/payroll` page, Gusto as optional processor |
| Webhook scope for MVP | Status sync + add `employee.created` handler |

## Section 1: Employee List — Gusto Status & Actions

The `EmployeeList` component gains Gusto awareness. Each employee row shows a badge indicating their Gusto state, and the row's action menu gains Gusto-specific actions. This only appears when the restaurant has an active Gusto connection — without one, the list looks exactly as it does today.

### Badge states (next to employee name/position)

- No badge — Gusto not connected for this restaurant
- `Not synced` (muted) — Employee exists locally but not in Gusto
- `Pending onboarding` (amber) — Synced to Gusto, waiting for employee to complete W-4/I-9/direct deposit
- `Onboarded` (green) — Employee completed Gusto onboarding

### Row actions (in the existing action menu)

- **Send to Gusto** — Calls `gusto-sync-employees` with this single `employeeId` and `selfOnboarding: true`. Requires the employee to have an email address (tooltip if missing). On success, badge updates to "Pending onboarding."
- **View Onboarding Status** — For employees in pending state, shows a small detail popover with which steps are complete.

### Data source

The `useEmployees` hook already returns `gusto_employee_uuid`, `gusto_sync_status`, and `gusto_onboarding_status` from the employees table. A `useGustoConnection` query (already exists) tells us whether the restaurant has Gusto connected, controlling badge/action visibility.

No new components — this extends `EmployeeList` and its row rendering. The hook for per-employee sync (`useGustoEmployeeSync.syncEmployees`) already accepts `employeeIds`.

## Section 2: Employee Mapping Flow

When a restaurant first connects Gusto (or clicks "Manage Employee Mapping" on the Gusto Payroll page), they see a mapping review screen. This is a one-time setup step that resolves the "employees exist in both systems" problem.

### Trigger

A banner appears on the `/payroll/gusto` page when unmapped Gusto employees are detected. "We found X employees in Gusto — map them to your existing staff." Clicking it opens the mapping dialog.

### How it works

1. Calls `gusto-pull-employees` with `syncMode: 'all'` to fetch Gusto's employee list
2. Fetches local employees without a `gusto_employee_uuid`
3. Auto-matches by email (case-insensitive). Falls back to exact name match.
4. Presents three groups in a dialog:

**Matched** (green) — Auto-matched pairs shown as "Local Name <-> Gusto Name (email)". Manager confirms or unlinks each.

**Unmatched Local** (amber) — Employees in EasyShiftHQ with no Gusto match. Each row has a dropdown to select a Gusto employee, or "Push to Gusto" to create them there, or "Skip" to leave unlinked.

**Unmatched Gusto** (blue) — Employees in Gusto with no local match. Each row has "Create locally" (runs the pull-employee logic) or "Skip."

### On confirm

For each confirmed pair, write the `gusto_employee_uuid` to the local employee record. For "Push to Gusto" selections, call `gusto-sync-employees`. For "Create locally", insert via the pull logic. Single batch operation.

### Component

New `GustoEmployeeMappingDialog` in `src/components/employee/`. Full-width dialog with a table layout.

## Section 3: Unified Payroll Page

The existing `/payroll` page becomes the single payroll entry point for all restaurants. Gusto is treated as a processing engine — when connected, it adds capabilities; when not, the page works exactly as it does today.

### Layout (tab-based, same structure regardless of Gusto)

- **Current Period** — Shows the active pay period: date range, employee hours summary, tips, total estimated compensation. Data comes from our system (time punches, tip splits, compensation calculations) — always available.
- **History** — Past pay periods with totals. Without Gusto: internal calculations + CSV export. With Gusto: enriched with actual payroll run data from `gusto_payroll_runs` (taxes, deductions, net pay).
- **Settings** — Pay period configuration. With Gusto: also shows connection status, "Manage Employee Mapping" button, link to Gusto company settings flow.

### The Gusto difference on Current Period tab

Without Gusto, the page ends with "Export to CSV" as the action. With Gusto, it adds a "Process Payroll" section below the summary — this is where the preview-then-submit flow lives (Section 4). After syncing, the Gusto "Run Payroll" embedded flow appears inline.

### Routing change

`/payroll/gusto` becomes the Gusto setup page only (connect, company onboarding flow, initial configuration). Day-to-day payroll moves to `/payroll`. The existing `/payroll` page gets refactored to support both modes via a `useGustoConnection` check — if `connection` exists, show the Gusto-enhanced UI; if not, show the current read-only view.

### No breaking changes

Internal payroll calculations remain the foundation. Gusto adds a processing layer on top.

## Section 4: Prepare Payroll — Preview & Sync

The "Process Payroll" section on the Current Period tab when Gusto is connected. Bridge between our data and Gusto's payroll engine.

### Flow

1. Manager navigates to `/payroll` -> Current Period tab
2. A card shows the pay period summary from our system: total hours, total tips (paycheck + cash), daily rate earnings, employee count. Always visible, computed locally — no Gusto call needed.
3. "Review Details" expands to show per-employee breakdown: name, hours (regular/OT/double-OT), tips, daily rate, estimated gross.
4. Manager clicks **"Sync to Gusto"**. Calls `gusto-prepare-payroll` with `dryRun: false`. Shows loading state, then success/error.
5. On success, Gusto "Run Payroll" embedded flow (iframe) appears below. Manager reviews taxes/deductions/net pay and submits payroll within the iframe.

### Edge cases

- **No unprocessed payrolls found** — Message explaining they need a payroll schedule in Gusto (link to company setup flow).
- **Hours not synced yet** — "Sync to Gusto" button first calls `gusto-sync-time-punches`, then `gusto-prepare-payroll`. Two-step progress indicator.
- **Payroll version conflict (409)** — "Someone else modified this payroll. Refresh and try again."

### Component

New `PayrollGustoProcessor` in `src/components/payroll/`. Receives `restaurantId` and `payPeriod` as props.

## Section 5: Webhook Additions

Minimal additions to close the bidirectional gap.

### New handler — `employee.created`

When someone adds an employee directly in Gusto, the webhook fires. Handler calls `gusto-pull-employees` with `syncMode: 'new_only'` for that restaurant. Creates the employee locally with `gusto_employee_uuid` pre-linked, position from Gusto job title, hourly rate if available. Employee appears on the Employees page immediately.

### Existing handlers — no changes needed

- `employee.updated` already syncs onboarding status (badges update automatically)
- `employee.terminated` already marks local employee as terminated
- `payroll.submitted/processed/paid` already creates `gusto_payroll_runs` records (History tab reads these)

### Payroll status on unified page

History tab queries `gusto_payroll_runs` for actual payroll outcomes. Status badges: "Submitted" (amber), "Processed" (blue), "Paid" (green). Each row shows check date, gross pay, taxes, net pay. Without Gusto, History shows internal calculations as today.

### NOT building for MVP

- Webhook health dashboard
- `employee.compensation_changed` handling
- Automatic P&L integration from payroll totals

## Section 6: Architecture & Data Flow

### Employee lifecycle

```
Create in EasyShiftHQ -> "Send to Gusto" (per-employee) -> Gusto creates employee
  -> Employee logs into portal -> Gusto self-onboarding iframe -> W-4/I-9/direct deposit
  -> Webhook: employee.updated -> badge updates to "Onboarded"
```

### Reverse flow (employee created in Gusto)

```
Webhook: employee.created -> auto-pull -> local employee created with gusto_uuid linked
```

### Existing employee mapping (one-time)

```
Connect Gusto -> banner on /payroll/gusto -> mapping dialog
  -> auto-match by email -> manager confirms -> gusto_uuid written to employees table
```

### Payroll run

```
Manager opens /payroll -> Current Period tab shows local summary
  -> "Sync to Gusto" -> sync time punches -> prepare payroll (tips, daily rates)
  -> Gusto "Run Payroll" iframe -> manager submits
  -> Webhook: payroll.paid -> gusto_payroll_runs updated -> History tab reflects actuals
```

### Without Gusto (nothing changes)

```
Manager opens /payroll -> Current Period tab shows local summary
  -> "Export CSV" -> done
```

### Files to create

- `src/components/employee/GustoEmployeeMappingDialog.tsx`
- `src/components/payroll/PayrollGustoProcessor.tsx`

### Files to modify

- `src/components/EmployeeList.tsx` — Gusto badges and row actions
- `src/pages/Payroll.tsx` — Unified payroll with Gusto-conditional sections
- `src/pages/GustoPayroll.tsx` — Add mapping banner, refocus as setup page
- `supabase/functions/gusto-webhooks/index.ts` — Add `employee.created` handler

### No new database tables

All data lives in existing `employees` columns (`gusto_*`) and `gusto_payroll_runs`.

## References

- [Gusto Embedded Payroll — Flows Quickstart](https://docs.gusto.com/embedded-payroll/docs/flows-quickstart)
- [Gusto Employee Self-Onboarding](https://docs.gusto.com/embedded-payroll/docs/employee-self-management)
- [Gusto Employee Onboarding](https://docs.gusto.com/embedded-payroll/docs/employee-onboarding)
- [Gusto W-2 Employee Onboarding via API](https://docs.gusto.com/embedded-payroll/docs/onboard-a-w2-employee)
- [Gusto Platform Overview](https://docs.gusto.com/embedded-payroll/docs/platform-overview)
- [Create Partner Managed Company](https://docs.gusto.com/embedded-payroll/reference/post-v1-partner-managed-companies)
