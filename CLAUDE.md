# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EasyShiftHQ is a **real-time restaurant management system** handling inventory, recipes, sales, P&L, payroll, and scheduling. Data accuracy is critical—stale data can cause stock-outs, incorrect financials, and operational issues.

## Development Commands

```bash
# Development
npm run dev                    # Vite dev server
npm run dev:full               # Dev server + Supabase + edge functions (concurrent)
npm run dev:full:sequential    # Same but starts sequentially
npm run db:start               # Start local Supabase
npm run db:stop                # Stop local Supabase
npm run db:reset               # Reset database with migrations
npm run functions:serve        # Serve edge functions locally

# Building
npm run build                  # Production build
npm run build:dev              # Development build
npm run lint                   # ESLint

# Testing
npm run test                   # Vitest (single run)
npm run test:watch             # Vitest (watch mode)
npm run test:coverage          # Vitest with coverage
npm run test:db                # pgTAP database tests
npm run test:e2e               # Playwright E2E tests
npm run test:e2e:ui            # Playwright with UI
npm run test:all               # All tests (unit + db + e2e)
```

## Architecture

### Tech Stack
- **Frontend**: React 18.3+, TypeScript, Vite, TailwindCSS, shadcn/ui, Lucide icons
- **Routing**: React Router 6 (NOT Next.js/Remix)
- **State**: React Query for server state, React Context for UI state (restaurant selection, auth)
- **Backend**: Supabase (PostgreSQL, Auth, Storage, 70+ Edge Functions in Deno)
- **Testing**: Vitest (unit), Playwright (E2E), pgTAP (SQL)

### Directory Structure
```text
src/
├── components/         # Feature components + ui/ (shadcn primitives)
├── pages/              # Route components (40+)
├── hooks/              # Custom hooks (118) - main business logic layer
├── contexts/           # React Context providers
├── services/           # External services (OCR, AI)
├── lib/                # Utility libraries (21)
├── types/              # TypeScript definitions
└── utils/              # Helper functions (25+)

supabase/
├── functions/          # Edge functions (70+) - serverless API
│   └── _shared/        # Shared utilities (ai-caller, encryption, etc.)
├── migrations/         # SQL migrations (300+)
└── tests/              # pgTAP database tests
```

### Key Architectural Patterns

**Multi-tenancy**: All data filtered by `restaurant_id`. RLS policies enforce isolation.

**Data fetching**: Custom hooks use React Query with short staleTime (30-60s max). Example:
```typescript
const { data, isLoading } = useQuery({
  queryKey: ['products', restaurantId],
  queryFn: () => fetchProducts(restaurantId),
  staleTime: 30000,
  refetchOnWindowFocus: true,
});
```

**Role-based access**: Roles are owner/manager/chef/staff/kiosk plus collaborators (collaborator_accountant, collaborator_inventory, collaborator_chef). ProtectedRoute wrapper enforces access.

**Edge functions pattern**: CORS handling → Auth → Permission check → Business logic → JSON response

## Critical Rules

### No Manual Caching
```typescript
// ❌ NEVER
localStorage.setItem('products', JSON.stringify(products));

// ✅ ONLY React Query with short staleTime
useQuery({ queryKey: [...], staleTime: 30000 });
```

### No Direct Colors
```typescript
// ❌ NEVER
className="bg-white text-black"

// ✅ ALWAYS semantic tokens
className="bg-background text-foreground"
```

### Always Handle States
```typescript
if (isLoading) return <Skeleton />;
if (error) return <ErrorMessage />;
if (!data?.length) return <EmptyState />;
return <div>{data.map(...)}</div>;
```

### Accessibility Required
- All buttons need `aria-label` if no visible text
- Form inputs need associated labels
- Interactive elements must be keyboard accessible

## Testing Requirements

All new code must have tests:

| Code Type | Test Location | Required |
|-----------|---------------|----------|
| Utility functions | `tests/unit/*.test.ts` | ✅ |
| Custom hooks | `tests/unit/*.test.ts` | ✅ |
| SQL functions | `supabase/tests/*.sql` | ✅ |
| UI components | - | Optional |

### SQL Test Pattern (pgTAP)
```sql
BEGIN;
SELECT plan(N);
-- tests using is(), ok(), lives_ok(), throws_ok()
SELECT * FROM finish();
ROLLBACK;
```

### E2E Test Pattern (Playwright)
- Import helpers from `'../helpers/e2e-supabase'` (relative path)
- Use `generateTestUser()` for unique test data
- Use accessible selectors: `page.getByRole()`, `page.getByLabel()`

## Unit Conversion System

**Critical**: The SQL function is authoritative—TypeScript is for preview only. Both must use identical constants.

Key files:
- `src/lib/enhancedUnitConversion.ts` - Client-side preview
- `supabase/migrations/*_inventory_*.sql` - Server-side (authoritative)
- `docs/UNIT_CONVERSIONS.md` - Full documentation

**Important**: Use `fl oz` for liquids, `oz` for weight. They convert differently.

## Integrations

### POS (Square, Clover, Toast, Shift4)
Use adapter pattern. Always write to `unified_sales` table. Never hardcode POS-specific logic in UI.

#### Toast POS Integration
**API Details:**
- Base URL: `https://ws-api.toasttab.com`
- Auth: OAuth with `TOAST_MACHINE_CLIENT` access type (Standard API Access)
- Standard API does NOT support webhooks or restaurant auto-discovery
- Location ID (Restaurant External GUID) must be obtained from Toast email or network inspector

**Data Format:**
- **Amounts are in DOLLARS, not cents** - Do NOT divide by 100
- Item names use `displayName` field (not `itemName` or `name`)
- Order totals are at check level, not order level - aggregate from `order.checks[]`
- Timestamps include timezone: `2026-01-26T21:35:48.071+0000` (UTC)

**Database Tables:**
```
toast_connections  → OAuth credentials (encrypted)
toast_orders       → Order headers
toast_order_items  → Line items (unique on restaurant_id, toast_item_guid, toast_order_guid)
toast_payments     → Payment records (unique on restaurant_id, toast_payment_guid, toast_order_guid)
unified_sales      → Normalized view for P&L (synced via RPC)
```

**Sync Pattern:**
- Initial sync: 90 days of historical data, processed in 3-day batches via `sync_cursor`
- Incremental sync: 25 hours (24h + buffer)
- Track via `initial_sync_done` and `sync_cursor` columns on connection
- Edge functions use service role key - remove `auth.uid()` checks from RPC functions
- **CPU Limits**: Edge functions have strict CPU limits (~10s). Batch processing and skip per-order RPC calls
- **unified_sales sync**: For large imports, defer to cron job (runs every 6 hours) to avoid timeouts
- Use `skipUnifiedSalesSync: true` in processOrder during bulk imports

**Key Files:**
- `supabase/functions/_shared/toastOrderProcessor.ts` - Order processing logic
- `supabase/functions/toast-sync-data/` - Manual sync endpoint (user-triggered)
- `supabase/functions/toast-bulk-sync/` - Scheduled sync (cron job)
- `src/hooks/useToastConnection.ts` - Frontend connection hook
- `src/components/pos/ToastSetupWizard.tsx` - Setup UI

**Scale Considerations (100+ restaurants):**
- Bulk sync processes max 5 restaurants per cron run (round-robin by `last_sync_time`)
- Max 200 orders per restaurant per run
- 2-second delay between restaurants to avoid API rate limits
- Cron runs every 6 hours - all restaurants eventually get synced
- For faster sync with many restaurants, increase cron frequency or add workers

**Testing Cron Locally:**
```bash
# Call bulk sync directly (simulates cron job)
curl -X POST http://localhost:54321/functions/v1/toast-bulk-sync \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

### Banking (Stripe Financial Connections)
Never store bank credentials. Use Stripe for credential storage. Always verify webhook signatures.

### AI (OpenRouter)
Multi-model fallback: free models first (Llama, Gemma), then paid (Gemini, Claude, GPT). AI suggestions stored separately—user must approve before applying.

## Performance Optimization

### List Virtualization
For lists with 100+ items, use `@tanstack/react-virtual`:

```typescript
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 56,
  overscan: 10,
});

// CRITICAL: Use stable ID as key, NOT index
{virtualizer.getVirtualItems().map((virtualRow) => (
  <div
    key={items[virtualRow.index].id}     // ✅ Stable ID
    data-index={virtualRow.index}         // ✅ Required for measureElement
    ref={virtualizer.measureElement}      // ✅ Dynamic height
  >
    <MemoizedRow item={items[virtualRow.index]} />
  </div>
))}
```

### Memoized Components
Row components in virtualized lists should:
- Use `React.memo` with custom comparison
- Have NO hooks inside—all data passed as props
- Receive stable callbacks (via `useCallback`)
- Receive pre-computed display values (via `useMemo`)

```typescript
export const MemoizedRow = memo(function MemoizedRow(props) {
  // NO hooks - just render
}, (prev, next) => {
  return prev.item.id === next.item.id &&
         prev.displayValues === next.displayValues;
});
```

### Single Dialog Pattern
Render ONE dialog at list level, not per row:
```typescript
const [activeItem, setActiveItem] = useState(null);
// Single dialog instance
{activeItem && <Dialog item={activeItem} />}
```

### Query Optimization
- Select explicit fields, not `*`
- Defer heavy data (raw_data, nested joins) until needed
- Increase page size when virtualized (500 vs 200)

## Common Hooks
- `useAuth()` → `{ user, loading, signIn, signOut }`
- `useRestaurantContext()` → `{ selectedRestaurant }`
- `useProducts(restaurantId)` → `{ products, loading }`
- `useBankTransactions()` → `{ transactions, loading }`
- `useToast()` → `{ toast }`

## Import Order
```typescript
// 1. React & ecosystem
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 2. UI components (shadcn)
import { Button } from '@/components/ui/button';

// 3. Icons
import { Plus, Edit } from 'lucide-react';

// 4. Custom hooks & contexts
import { useProducts } from '@/hooks/useProducts';

// 5. Types
import { Product } from '@/hooks/useProducts';

// 6. Utils
import { cn } from '@/lib/utils';
```

## UI Styling (Apple/Notion Aesthetic)

Use consistent Apple/Notion-inspired styling across all pages and dialogs. This creates a clean, professional appearance.

### Typography Scale
```typescript
// Titles and headings
className="text-[17px] font-semibold text-foreground"        // Dialog titles
className="text-[15px] text-muted-foreground"                // Subtitles
className="text-[14px] font-medium text-foreground"          // Body text, list items
className="text-[13px] text-muted-foreground"                // Secondary text
className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider" // Form labels
className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted"    // Badges, counts
```

### Dialog Structure
```typescript
<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
  {/* Header with icon box */}
  <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
        <Icon className="h-5 w-5 text-foreground" />
      </div>
      <div>
        <DialogTitle className="text-[17px] font-semibold text-foreground">Title</DialogTitle>
        <p className="text-[13px] text-muted-foreground mt-0.5">Description</p>
      </div>
    </div>
  </DialogHeader>
  <div className="px-6 py-5 space-y-5">{/* Content */}</div>
</DialogContent>
```

### Form Elements
```typescript
// Labels (uppercase tracking)
<Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
  Field Name
</Label>

// Inputs
<Input className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border" />

// Selects (same as inputs)
<Select>
  <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
```

### Buttons
```typescript
// Primary action
className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"

// Secondary/ghost
className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"

// Destructive
className="text-destructive hover:text-destructive/80"
```

### Apple-Style Underline Tabs
```typescript
<button
  onClick={() => setActiveTab('tab1')}
  className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
    activeTab === 'tab1' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`}
>
  Tab Label
  {activeTab === 'tab1' && (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
  )}
</button>
```

### Cards and Containers
```typescript
// List item card
className="group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"

// Form section with header
<div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
  <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
    <h3 className="text-[13px] font-semibold text-foreground">Section Title</h3>
  </div>
  <div className="p-4 space-y-4">{/* Form fields */}</div>
</div>

// AI suggestion panel
className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
```

### Switch (Toggle)
```typescript
<Switch className="data-[state=checked]:bg-foreground" />
```

### Common Patterns
- Use `border-border/40` for subtle borders
- Use `bg-muted/30` for subtle backgrounds
- Use `rounded-lg` for inputs/buttons, `rounded-xl` for cards/containers
- Use `transition-colors` for hover states
- Use `opacity-0 group-hover:opacity-100` for hover-reveal actions

## Additional Documentation
- `docs/ARCHITECTURE.md` - Full architecture guide
- `docs/INTEGRATIONS.md` - Integration patterns
- `docs/UNIT_CONVERSIONS.md` - Unit conversion system
- `.github/copilot-instructions.md` - Extended coding guidelines
