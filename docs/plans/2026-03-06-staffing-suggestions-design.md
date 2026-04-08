# Staffing Suggestions Design

## Overview

Add an AI-free, formula-based staffing suggestion overlay to the shift planner. Uses historical POS sales data and SPLH (Sales Per Labor Hour) calculations to recommend headcount per hour, then consolidates into shift-length blocks that managers can apply with one click.

## Problem

Managers manually estimate how many staff to schedule per shift without data-driven guidance. This leads to overstaffing (wasted labor cost) or understaffing (poor service, lost sales).

## Solution

A collapsible overlay panel in the ShiftPlannerTab that:

1. Computes hourly sales patterns from unified_sales history
2. Applies SPLH formula to recommend headcount per hour
3. Checks against labor % guardrails
4. Consolidates into shift-length blocks
5. Creates unassigned shifts on "Apply"

## Data Model

### New table: `staffing_settings`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | UUID | gen_random_uuid() | PK |
| restaurant_id | UUID | FK restaurants | One per restaurant (UNIQUE) |
| target_splh | NUMERIC | 60.00 | Target Sales Per Labor Hour ($) |
| avg_ticket_size | NUMERIC | 8.00 | Average order ticket ($) |
| target_labor_pct | NUMERIC | 22.0 | Labor cost % guardrail |
| min_staff | INTEGER | 1 | Minimum staff any open hour |
| lookback_weeks | INTEGER | 4 | Weeks of history to average |
| manual_projections | JSONB | null | Manual daily revenue fallback |
| created_at | TIMESTAMPTZ | now() | |
| updated_at | TIMESTAMPTZ | now() | |

RLS: owner/manager read/write only.

## Calculation Engine

All client-side TypeScript. No edge functions.

### Step 1: Hourly sales curve

Query `unified_sales` grouped by `EXTRACT(HOUR FROM sale_time)`, filtered by matching day-of-week, averaged over last N weeks (configurable via `lookback_weeks`).

Result: `Map<dayOfWeek, Map<hour, avgSales>>`

### Step 2: Recommended headcount

```
recommendedStaff = Math.ceil(projectedSales / targetSPLH)
recommendedStaff = Math.max(recommendedStaff, minStaff)
```

### Step 3: Labor % guardrail

```
estimatedLaborCost = recommendedStaff * avgHourlyRate
laborPct = estimatedLaborCost / projectedSales
// Flag as warning if laborPct > targetLaborPct (don't auto-reduce below minStaff)
```

### Step 4: Consolidate into shift blocks

- Find contiguous hour ranges with similar headcount
- Merge into 4-8 hour shift blocks
- Prefer existing templates when time ranges match
- Result: `{ startTime, endTime, headcount }[]` per day

## UI Design

### Planner Overlay (above template grid)

- **Collapsed**: "Staffing Suggestions available for this week" + expand chevron
- **Expanded**: Per-day columns matching grid layout
  - Hourly visualization (bar chart or heatmap blocks)
  - Recommended headcount numbers
  - Color: soft blue/green = recommended, yellow = over labor % target
  - Current scheduled count overlaid to show gaps
  - "Apply to Week" button (top-right)
  - Per-day "Apply" buttons
  - Inline parameter overrides (SPLH, avg ticket)

### Settings Tab (Restaurant Settings)

New "Labor Planning" tab:
- Target SPLH, avg ticket, labor %, min staff, lookback weeks
- "No POS" state with link to POS integration

### Apply Flow

1. Click "Apply to Week" or per-day "Apply"
2. Confirmation dialog: "Create X unassigned shifts. Existing shifts unaffected."
3. Unassigned shift blocks appear in template grid
4. Manager assigns employees via drag-drop

### Manual Fallback (No POS Data)

- Overlay shows "No sales history available"
- Form to enter expected daily revenue per day-of-week
- Stored in `staffing_settings.manual_projections` (JSONB)
- Same SPLH calculations apply

## File Changes

### New Files (~12)

| File | Purpose |
|------|---------|
| `supabase/migrations/XXXX_create_staffing_settings.sql` | Table + RLS |
| `src/hooks/useStaffingSettings.ts` | CRUD hook |
| `src/hooks/useHourlySalesPattern.ts` | Query sales by hour/day |
| `src/hooks/useStaffingSuggestions.ts` | Sales curve to shift blocks |
| `src/lib/staffingCalculator.ts` | Pure calculation functions |
| `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` | Collapsible panel |
| `src/components/scheduling/ShiftPlanner/StaffingDayColumn.tsx` | Per-day visualization |
| `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx` | Inline overrides |
| `tests/unit/staffingCalculator.test.ts` | Calculator tests |
| `tests/unit/useStaffingSuggestions.test.ts` | Hook tests |
| `supabase/tests/staffing_settings.test.sql` | pgTAP tests |

### Modified Files (~3)

| File | Change |
|------|--------|
| `ShiftPlannerTab.tsx` | Add StaffingOverlay |
| `RestaurantSettings.tsx` | Add Labor Planning tab |
| `src/types/scheduling.ts` | Add types |

## Industry Defaults

| Metric | Default | Source |
|--------|---------|--------|
| Target SPLH | $60 | Average QSR benchmark |
| Avg ticket | $8 | QSR average |
| Target labor % | 22% | Industry standard |
| Min staff | 1 | Safety minimum |
| Lookback weeks | 4 | Balances recency vs. noise |

## Out of Scope (v2)

- AI-powered sales forecasting (OpenRouter)
- Employee auto-assignment based on availability/skills
- Queue simulation / wait time prediction
- Position-level staffing (register vs production)
- Seasonal adjustments
