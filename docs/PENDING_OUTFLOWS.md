# Pending Outflows Feature

## Overview

The Pending Outflows feature allows restaurant owners to track money that has been committed (checks written, ACH payments initiated) but has not yet cleared the bank. This provides an accurate "Book Balance" that shows the true available cash after pending obligations.

## Problem Solved

When restaurant owners write checks or initiate ACH payments, the money is committed but may not clear the bank for several days. Without tracking these pending outflows:
- Bank balance shows more cash than is actually available
- Risk of overdrafts or bounced checks
- Difficulty planning cash flow and expenses

This feature solves these problems by:
1. Tracking pending payments separately
2. Calculating "Book Balance" (Bank Balance - Pending Outflows)
3. Automatically matching and clearing when bank transactions appear
4. Alerting on stale checks (30, 60, 90+ days old)

## User Flow

### Adding a Pending Outflow

1. Navigate to **Banking** → **Pending Outflows** tab
2. Click **"+ Add Payment"** button
3. Fill in the form:
   - **Payee/Vendor**: Who you're paying (e.g., "Sysco")
   - **Payment Method**: Check, ACH, or Other
   - **Amount**: Payment amount
   - **Issue/Due Date**: When the check was written or ACH initiated
   - **Reference/Check #**: Optional check number or reference
   - **Category**: Optional expense category
   - **Notes**: Optional additional details
4. Click **Save**

The pending outflow is now tracked, and Book Balance is updated.

### Automatic Matching

When a bank transaction appears that matches a pending outflow:
- System suggests matches based on:
  - Amount (within $10)
  - Date (within 30 days)
  - Payee name similarity
- Match score shown (0-100%)
- High-confidence matches (≥85%) highlighted in green

### Confirming a Match

1. View the pending outflow card
2. See suggested matches with match scores
3. Click **"Confirm Match"** on the correct transaction
4. Pending outflow marked as "Cleared"
5. Bank transaction marked as categorized
6. Book Balance automatically updated

### Managing Pending Outflows

**Void a Payment** (e.g., check cancelled):
1. Click void icon on pending outflow card
2. Enter reason for voiding
3. Click **Void Payment**

**Delete a Payment**:
1. Click delete icon on pending outflow card
2. Confirm deletion

**Stale Checks**:
- System automatically marks checks as stale after 30, 60, or 90 days
- Status badge changes color to indicate staleness
- Consider voiding or following up on stale checks

## Database Schema

### pending_outflows Table

```sql
CREATE TABLE public.pending_outflows (
  id UUID PRIMARY KEY,
  restaurant_id UUID REFERENCES restaurants,
  vendor_name TEXT NOT NULL,
  category_id UUID REFERENCES chart_of_accounts,
  payment_method TEXT CHECK (payment_method IN ('check', 'ach', 'other')),
  amount NUMERIC(15, 2) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE,
  notes TEXT,
  reference_number TEXT,
  status TEXT CHECK (status IN ('pending', 'cleared', 'voided', 'stale_30', 'stale_60', 'stale_90')),
  linked_bank_transaction_id UUID REFERENCES bank_transactions,
  cleared_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Matching Algorithm

Function: `suggest_pending_outflow_matches()`

**Scoring System (0-100)**:
- Amount Match (max 60 points):
  - Exact: 60 points
  - Within $1: 45 points
  - Within $5: 20 points
- Date Match (max 20 points):
  - Same day: 20 points
  - ≤3 days: 15 points
  - ≤7 days: 10 points
  - ≤10 days: 5 points
- Payee Match (max 20 points):
  - Exact match: 20 points
  - Contains: 10 points

**Match Thresholds**:
- ≥85: High confidence (auto-suggest)
- 70-84: Medium confidence
- <70: Low confidence (not shown)

## UI Components

### Components Created

1. **AddPendingOutflowDialog** (`src/components/pending-outflows/AddPendingOutflowDialog.tsx`)
   - Modal form for adding new pending payments
   - Form validation
   - Category selection from chart of accounts

2. **PendingOutflowsList** (`src/components/pending-outflows/PendingOutflowsList.tsx`)
   - Main list view showing all pending outflows
   - Summary of total pending amount
   - Empty state with call-to-action

3. **PendingOutflowCard** (`src/components/pending-outflows/PendingOutflowCard.tsx`)
   - Individual pending outflow display
   - Status badges (pending, stale, cleared, voided)
   - Actions: confirm match, void, delete
   - Expandable match suggestions

4. **MatchSuggestionCard** (`src/components/pending-outflows/MatchSuggestionCard.tsx`)
   - Shows suggested bank transaction matches
   - Match score and confidence indicator
   - Transaction details
   - One-click confirm action

### Banking Page Integration

**Dashboard Metrics** (4 cards):
1. **Bank Balance**: Current balance from connected banks
2. **Pending Outflows**: Total pending payments (red)
3. **Book Balance**: Bank Balance - Pending Outflows (green, shows true available)
4. **Connected Banks**: Number of connected accounts

**New Tab**:
- "Pending Outflows" tab added to Banking page
- Shows count and total amount badge
- Badge shows formatted amount (e.g., "$6.5k")

## Custom Hooks

### usePendingOutflows()

Fetches pending outflows for the selected restaurant.

```typescript
const { data: pendingOutflows, isLoading, error } = usePendingOutflows();
```

**Returns**: Array of `PendingOutflow` objects

**Features**:
- Automatically filters by restaurant
- Includes related chart of accounts data
- 30-second stale time
- Refetches on window focus

### usePendingOutflowMatches(pendingOutflowId?)

Fetches suggested matches for pending outflows.

```typescript
const { data: matches } = usePendingOutflowMatches(outflowId);
```

**Returns**: Array of `PendingOutflowMatch` objects with scores

### usePendingOutflowMutations()

Provides mutation functions for CRUD operations.

```typescript
const {
  createPendingOutflow,
  updatePendingOutflow,
  voidPendingOutflow,
  confirmMatch,
  deletePendingOutflow,
} = usePendingOutflowMutations();
```

**Features**:
- Automatic query invalidation on success
- Toast notifications for all operations
- Error handling with user-friendly messages

## Security

### Row Level Security (RLS)

All policies check that the user has access to the restaurant:

- **SELECT**: Users can view outflows for their restaurants
- **INSERT**: Only owners and managers can create
- **UPDATE**: Only owners and managers can update
- **DELETE**: Only owners and managers can delete

### Data Validation

- Payment method constrained to: check, ach, other
- Status constrained to valid values
- Amount must be positive
- Foreign key constraints for restaurant_id, category_id, linked_bank_transaction_id

## Calculations

### Book Balance Formula

```
Book Balance = Bank Balance - Total Pending Outflows

where Total Pending Outflows = SUM(amount) 
  WHERE status IN ('pending', 'stale_30', 'stale_60', 'stale_90')
```

### Stale Check Detection

Runs periodically (or on-demand via function):

```sql
-- Mark as stale_30 (30-59 days old)
UPDATE pending_outflows SET status = 'stale_30'
WHERE status = 'pending' 
  AND issue_date <= CURRENT_DATE - INTERVAL '30 days'
  AND issue_date > CURRENT_DATE - INTERVAL '60 days';

-- Mark as stale_60 (60-89 days old)
UPDATE pending_outflows SET status = 'stale_60'
WHERE status IN ('pending', 'stale_30')
  AND issue_date <= CURRENT_DATE - INTERVAL '60 days'
  AND issue_date > CURRENT_DATE - INTERVAL '90 days';

-- Mark as stale_90 (90+ days old)
UPDATE pending_outflows SET status = 'stale_90'
WHERE status IN ('pending', 'stale_30', 'stale_60')
  AND issue_date <= CURRENT_DATE - INTERVAL '90 days';
```

## Future Enhancements

Potential improvements for future iterations:

1. **Scheduled Payments**: Set up recurring or future-dated pending outflows
2. **Batch Operations**: Void or confirm multiple pending outflows at once
3. **Export**: Download pending outflows report as CSV/PDF
4. **Notifications**: Alert when checks become stale or when matches are found
5. **Budget Integration**: Track pending outflows against budget categories
6. **Split Matching**: Match one pending outflow to multiple transactions (or vice versa)
7. **Mobile Support**: Optimize UI for mobile devices (Capacitor)
8. **AI Enhancement**: Use AI to improve payee matching accuracy

## Troubleshooting

### Match Not Appearing

If a bank transaction should match but doesn't appear:

1. Check amount tolerance (<$10 difference)
2. Check date tolerance (within 30 days)
3. Check that bank transaction is uncleared (not already matched)
4. Verify payee names are similar

### Book Balance Incorrect

If Book Balance calculation seems wrong:

1. Check for pending outflows stuck in stale status
2. Verify all bank balances are synced
3. Check for voided outflows still showing
4. Refresh bank connections

### Performance Issues

If experiencing slow load times:

1. Database indexes are in place (check migration)
2. Limit query results with pagination if needed
3. Check for orphaned pending outflows (restaurant deleted)

## Testing Checklist

Manual testing steps:

- [ ] Add a pending outflow with all fields filled
- [ ] Add a pending outflow with only required fields
- [ ] Verify Book Balance updates immediately
- [ ] Create a matching bank transaction
- [ ] Verify match suggestion appears
- [ ] Confirm the match
- [ ] Verify pending outflow marked as cleared
- [ ] Verify bank transaction marked as categorized
- [ ] Void a pending outflow
- [ ] Delete a pending outflow
- [ ] Check responsive design on mobile viewport
- [ ] Test keyboard navigation in forms
- [ ] Test screen reader accessibility

## Migration Notes

To apply this feature to a Supabase project:

1. Run the migration: `supabase/migrations/20251107141500_pending_outflows.sql`
2. Deploy the updated frontend code
3. No data migration needed (new feature)
4. No breaking changes to existing functionality

## Related Files

**Database**:
- `supabase/migrations/20251107141500_pending_outflows.sql`

**Types**:
- `src/types/pending-outflows.ts`

**Hooks**:
- `src/hooks/usePendingOutflows.tsx`

**Components**:
- `src/components/pending-outflows/AddPendingOutflowDialog.tsx`
- `src/components/pending-outflows/PendingOutflowsList.tsx`
- `src/components/pending-outflows/PendingOutflowCard.tsx`
- `src/components/pending-outflows/MatchSuggestionCard.tsx`

**Pages**:
- `src/pages/Banking.tsx` (updated)

## Support

For questions or issues:
1. Check this documentation first
2. Review the database migration for schema details
3. Check browser console for error messages
4. Verify RLS policies are in place
5. Contact development team with specific error details
