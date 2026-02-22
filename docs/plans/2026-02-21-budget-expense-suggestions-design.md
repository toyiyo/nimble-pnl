# Budget Expense Suggestions — Design

## Problem

The Budget & Run Rate page requires managers to manually add all operating costs. Restaurants that have connected bank accounts or use payroll already have financial data showing recurring expenses (rent, insurance, subscriptions, etc.), but this data is not used to help managers set up their budget. Managers may miss expenses or enter inaccurate amounts.

## Solution

Detect recurring expenses from bank transactions and payroll data, then surface inline suggestion banners inside the relevant cost blocks on the Budget page. Managers accept, snooze, or dismiss each suggestion.

## Data Sources

- **Bank transactions**: Outflows from `bank_transactions` table (last 90 days), grouped by `normalized_payee` / `merchant_name`, with category from `chart_of_accounts` via `category_id`.
- **Payroll**: If payroll data exists but no Labor entry is tracked in budget costs, suggest it with the average monthly payroll amount.
- Not all restaurants have bank connections — the feature gracefully degrades (payroll-only suggestions, or no suggestions at all).

## Detection Algorithm

Runs client-side in a `useExpenseSuggestions` hook:

1. Fetch bank transaction outflows for the last 90 days (reuse `expenseDataFetcher`).
2. Group by `normalized_payee` (fallback: `merchant_name`).
3. Bucket each payee's transactions by calendar month.
4. Flag as **recurring** if the payee appears in 2+ of the last 3 months AND amounts are within 20% variance.
5. Compute average monthly amount across detected months.
6. Map to a cost block type using the transaction's `account_subtype`:
   - `rent` → Fixed
   - `insurance` → Fixed
   - `utilities` → Semi-Variable
   - `subscriptions`, `software` → Fixed
   - Everything else → Custom
7. Exclude expenses already tracked in `restaurant_operating_costs` (match by name or category).
8. Check payroll: if payroll exists but no Labor entry in budget, suggest it.
9. Filter out dismissed/snoozed suggestions from `expense_suggestion_dismissals`.

### Output Type

```typescript
interface ExpenseSuggestion {
  id: string;              // deterministic hash of payee+category
  payeeName: string;       // "ABC Landlord LLC"
  suggestedName: string;   // "Rent / Lease" (mapped from category)
  costType: CostType;      // 'fixed' | 'semi_variable' | 'variable' | 'custom'
  monthlyAmount: number;   // average in cents
  confidence: number;      // 0-1 based on months matched + variance
  source: 'bank' | 'payroll';
  matchedMonths: number;
}
```

## UI Design

### Inline Suggestion Banners

Inside each cost block, when suggestions exist for that block type, banners appear **above existing items**:

```
┌─────────────────────────────────────────────────────────┐
│  Fixed Costs                                    + Add   │
│─────────────────────────────────────────────────────────│
│  ┌─ amber banner ─────────────────────────────────────┐ │
│  │  We found a recurring $3,500/mo payment to         │ │
│  │  ABC Landlord. Add as "Rent / Lease"?              │ │
│  │                                                    │ │
│  │     [Add to Budget]   [Not Now]   [Dismiss]        │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  Rent / Lease .......................... $0/mo   edit del│
│  Property Insurance ................... $0/mo   edit del│
└─────────────────────────────────────────────────────────┘
```

### Actions

- **Add to Budget**: Opens `CostItemDialog` pre-filled with suggested name and amount. Manager can edit before saving. Records `accepted` in dismissals table.
- **Not Now**: Snoozes for 30 days. Records `snoozed` with `snoozed_until` date.
- **Dismiss**: Permanently dismisses. Records `dismissed`.

### Styling

- Banner: `bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5`
- Text: `text-[13px]`
- Buttons: `h-9 rounded-lg text-[13px] font-medium`
- Max 3 banners per cost block; "Show N more" link if exceeded.

## Data Storage

### `expense_suggestion_dismissals` Table

```sql
CREATE TABLE expense_suggestion_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  suggestion_key TEXT NOT NULL,       -- "{normalized_payee}:{account_subtype}"
  action TEXT NOT NULL,               -- 'dismissed' | 'snoozed' | 'accepted'
  snoozed_until TIMESTAMPTZ,          -- NULL for dismissed/accepted
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id, suggestion_key)
);
```

RLS: Owner/manager access only, same pattern as `restaurant_operating_costs`.

Upsert on snooze/dismiss — the unique constraint on `(restaurant_id, suggestion_key)` ensures one row per suggestion per restaurant.

## Testing Strategy (Test-First)

### Unit Tests (Vitest)

**`useExpenseSuggestions` hook**:
- Detects recurring payee appearing 2+ months with similar amounts
- Does not flag one-time transactions
- Handles 20% variance threshold correctly (edge cases at boundary)
- Maps `account_subtype` to correct cost block type
- Excludes expenses already tracked in `restaurant_operating_costs`
- Excludes permanently dismissed suggestions
- Respects snooze period (shows after expiry, hides during)
- Handles empty bank transactions gracefully
- Handles payroll data: suggests Labor entry when missing
- Handles restaurants with no bank connection (payroll-only suggestions)

**`ExpenseSuggestionBanner` component**:
- Renders suggestion with payee name, amount, and suggested name
- "Add to Budget" opens pre-filled dialog
- "Not Now" calls snooze mutation
- "Dismiss" calls dismiss mutation
- Max 3 shown with "Show N more" when exceeded

### Database Tests (pgTAP)
- RLS: owner/manager can CRUD, staff cannot
- Unique constraint on `(restaurant_id, suggestion_key)` enforced
- Upsert on snooze works correctly

### E2E Tests (Playwright)
- With bank data: suggestion banner appears in correct cost block
- Accept flow: banner → dialog pre-filled → save → suggestion gone, cost entry added
- Snooze flow: click "Not Now" → banner disappears
- Dismiss flow: click "Dismiss" → banner disappears permanently

## Scope Boundaries

- No AI/ML — pure rule-based pattern matching
- No new edge functions — all client-side
- No changes to existing manual entry flow
- No notification system
- Suggestions are additive guidance only — managers always control what gets budgeted
