# Shift Trading Integration Guide

## Quick Start

This guide shows how to integrate the shift trading components into your existing schedule views.

## Step 1: Apply Database Migration

```bash
# Reset database to apply new migration
npm run db:reset

# Or apply just the new migration
supabase db push
```

## Step 2: Add to Employee Schedule View

Find your employee schedule component (likely in `src/pages/` or `src/components/`) and add:

```tsx
import { useState } from 'react';
import { TradeRequestDialog } from '@/components/schedule/TradeRequestDialog';
import { ArrowRightLeft } from 'lucide-react';

// Inside your schedule component:
export const EmployeeSchedule = () => {
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const { employee } = useCurrentEmployee();
  const { selectedRestaurant } = useRestaurantContext();

  const handleTradeClick = (shift) => {
    setSelectedShift(shift);
    setTradeDialogOpen(true);
  };

  return (
    <div>
      {/* Your existing schedule view */}
      {shifts.map((shift) => (
        <ShiftCard key={shift.id}>
          {/* ... shift details ... */}
          
          {/* Add Trade Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleTradeClick(shift)}
            data-testid="trade-button"
          >
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Trade
          </Button>
        </ShiftCard>
      ))}

      {/* Trade Dialog */}
      {selectedShift && (
        <TradeRequestDialog
          open={tradeDialogOpen}
          onOpenChange={setTradeDialogOpen}
          shift={selectedShift}
          restaurantId={selectedRestaurant?.id}
          currentEmployeeId={employee?.id}
        />
      )}
    </div>
  );
};
```

## Step 3: Add Trade Marketplace Page

Create new page at `src/pages/TradeMarketplace.tsx`:

```tsx
import { TradeMarketplace } from '@/components/schedule/TradeMarketplace';

export default function TradeMarketplacePage() {
  return (
    <div className="container mx-auto py-8">
      <TradeMarketplace />
    </div>
  );
}
```

Add route in your router:

```tsx
// In your router configuration (e.g., App.tsx or routes.tsx)
import TradeMarketplacePage from '@/pages/TradeMarketplace';

// Add route:
<Route path="/trade-marketplace" element={<TradeMarketplacePage />} />
```

## Step 4: Add to Navigation

Add marketplace link to employee navigation:

```tsx
// In your employee navigation/sidebar component
import { Store } from 'lucide-react';

<Link
  to="/trade-marketplace"
  className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
>
  <Store className="h-5 w-5" />
  <span>Trade Marketplace</span>
</Link>
```

## Step 5: Add Manager Approval UI

Add to manager schedule/dashboard:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TradeApprovalQueue } from '@/components/schedule/TradeApprovalQueue';
import { useShiftTrades } from '@/hooks/useShiftTrades';
import { Badge } from '@/components/ui/badge';

export const ManagerSchedule = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const { trades } = useShiftTrades(selectedRestaurant?.id, 'pending_approval');
  const pendingCount = trades.length;

  return (
    <Tabs defaultValue="schedule">
      <TabsList>
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
        <TabsTrigger value="trades" className="relative">
          Trade Requests
          {pendingCount > 0 && (
            <Badge
              variant="destructive"
              className="ml-2 h-5 w-5 rounded-full p-0 text-xs"
            >
              {pendingCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="schedule">
        {/* Your existing schedule view */}
      </TabsContent>
      
      <TabsContent value="trades">
        <TradeApprovalQueue />
      </TabsContent>
    </Tabs>
  );
};
```

## Step 6: Update Shift Cards (Optional)

Add visual indicator for shifts with pending trades:

```tsx
import { useShiftTrades } from '@/hooks/useShiftTrades';
import { ArrowRightLeft } from 'lucide-react';

const ShiftCard = ({ shift, restaurantId, employeeId }) => {
  const { trades } = useShiftTrades(restaurantId, ['open', 'pending_approval'], employeeId);
  
  // Check if this shift has a pending trade
  const hasPendingTrade = trades.some(
    (trade) => trade.offered_shift_id === shift.id
  );

  return (
    <Card data-testid="shift-card">
      {hasPendingTrade && (
        <Badge variant="outline" className="absolute right-2 top-2">
          <ArrowRightLeft className="mr-1 h-3 w-3" />
          Trade Pending
        </Badge>
      )}
      {/* ... rest of shift card ... */}
    </Card>
  );
};
```

## Step 7: Test Integration

Run the E2E test to verify everything works:

```bash
npm run test:e2e -- tests/e2e/shift-trading.spec.ts
```

## Quick Reference: Component Props

### TradeRequestDialog
```tsx
interface TradeRequestDialogProps {
  open: boolean;                  // Dialog open state
  onOpenChange: (open: boolean) => void;  // Close handler
  shift: Shift;                   // Shift being traded
  restaurantId: string;           // Current restaurant ID
  currentEmployeeId: string;      // Current employee ID
}
```

### TradeMarketplace
```tsx
// No props needed - uses context internally
<TradeMarketplace />
```

### TradeApprovalQueue
```tsx
// No props needed - uses context internally
<TradeApprovalQueue />
```

## Hooks Reference

```tsx
// Get all trades
const { trades, loading, error } = useShiftTrades(
  restaurantId,
  'pending_approval',  // optional status filter
  employeeId           // optional employee filter
);

// Get marketplace trades (with conflict detection)
const { trades, loading } = useMarketplaceTrades(
  restaurantId,
  currentEmployeeId
);

// Create trade
const { mutate: createTrade, isPending } = useCreateShiftTrade();

// Accept trade
const { mutate: acceptTrade } = useAcceptShiftTrade();

// Approve trade (manager)
const { mutate: approveTrade } = useApproveShiftTrade();

// Reject trade (manager)
const { mutate: rejectTrade } = useRejectShiftTrade();

// Cancel trade
const { mutate: cancelTrade } = useCancelShiftTrade();
```

## Troubleshooting

### "Function not found" error
Make sure you ran the database migration:
```bash
npm run db:reset
```

### Email notifications not sending
Check that Resend API key is set in `.env`:
```
RESEND_API_KEY=re_xxxxx
```

### Conflicts not detected
Verify the `check_availability` function exists in your database. If not, conflict detection will only check for overlapping shifts.

### TypeScript errors
Regenerate Supabase types:
```bash
npm run supabase:generate-types
```

## Testing Checklist

After integration, verify:
- [ ] Employee can see "Trade" button on their shifts
- [ ] Trade dialog opens with marketplace/directed options
- [ ] Marketplace page loads and shows available shifts
- [ ] Conflicts are marked as unavailable
- [ ] Manager sees pending trades tab
- [ ] Manager can approve/reject trades
- [ ] Shift ownership transfers on approval
- [ ] Emails are sent (check Resend dashboard)
- [ ] E2E test passes

## Support

If you encounter issues:
1. Check the [full implementation docs](./SHIFT_TRADING_IMPLEMENTATION.md)
2. Review E2E test for expected behavior
3. Verify database migration applied correctly
4. Check browser console for errors
5. Test hooks independently in isolation

---

**Last Updated**: January 4, 2026  
**Version**: 1.0.0
