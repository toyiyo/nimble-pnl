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
- `supabase/functions/toast-sync-data/` - Manual sync endpoint
- `src/hooks/useToastConnection.ts` - Frontend connection hook
- `src/components/pos/ToastSetupWizard.tsx` - Setup UI

### Banking (Stripe Financial Connections)
Never store bank credentials. Use Stripe for credential storage. Always verify webhook signatures.

### AI (OpenRouter)
Multi-model fallback: free models first (Llama, Gemma), then paid (Gemini, Claude, GPT). AI suggestions stored separately—user must approve before applying.

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

## Additional Documentation
- `docs/ARCHITECTURE.md` - Full architecture guide
- `docs/INTEGRATIONS.md` - Integration patterns
- `docs/UNIT_CONVERSIONS.md` - Unit conversion system
- `.github/copilot-instructions.md` - Extended coding guidelines
