# GitHub Copilot Instructions

> Instructions for AI coding assistants working on this restaurant management system.

## 🎯 Project Context

This is a **real-time restaurant management system** handling inventory, recipes, sales, and P&L. Data accuracy is critical - stale data can cause stock-outs, incorrect financials, and operational issues.

---

## ⚠️ Critical Rules - READ FIRST

# foundational rules that must always be followed.
DRY Principle: No repeated code - shared logic must be abstracted
Maintainability: Changes to business logic should be easy to implement
Consistency: Follow existing project patterns and styles
Accessibility: All UI components must be accessible (ARIA, keyboard)
Type Safety: Use TypeScript types everywhere
Performance: Optimize for speed and responsiveness
Testability: All new code must be covered by tests - no exceptions


### 1. **NO Manual Caching**
```typescript
// ❌ NEVER write code like this:
localStorage.setItem('products', JSON.stringify(products));
const cached = localStorage.getItem('inventory');
let productCache = null;

// ✅ ONLY use React Query with short staleTime
const { data } = useQuery({
  queryKey: ['products'],
  queryFn: fetchProducts,
  staleTime: 30000, // Max 60 seconds
});
```

### 2. **NO Direct Colors**
```typescript
// ❌ NEVER use direct colors:
className="bg-white text-black border-gray-300"

// ✅ ALWAYS use semantic tokens:
className="bg-background text-foreground border-border"
```

### 3. **ALWAYS Add Accessibility**
```typescript
// ❌ NEVER write inaccessible components:
<button onClick={handleClick}>
  <X />
</button>

// ✅ ALWAYS include ARIA labels and keyboard support:
<button 
  onClick={handleClick}
  aria-label="Close dialog"
  onKeyDown={(e) => e.key === 'Enter' && handleClick()}
>
  <X />
</button>
```

### 4. **ALWAYS Handle Loading & Error States**
```typescript
// ❌ NEVER assume data exists:
return <div>{products.map(...)}</div>

// ✅ ALWAYS handle loading and error:
if (loading) return <Skeleton />;
if (error) return <ErrorMessage />;
if (!products?.length) return <EmptyState />;
return <div>{products.map(...)}</div>
```

### 5. **ALWAYS Write Tests for New Code**
```typescript
// ❌ NEVER submit code without tests:
// - New utility functions
// - New hooks
// - New business logic
// - New SQL functions/migrations

// ✅ ALWAYS include corresponding tests:
// TypeScript: tests/unit/*.test.ts
// SQL: supabase/tests/*.sql (pgTAP)

// Example: If you create src/lib/calculateTax.ts
// You MUST also create tests/unit/calculateTax.test.ts
```

---

## 🏗️ Technology Stack

### Required Technologies (DO NOT suggest alternatives)
- **Frontend**: React 18.3+, TypeScript, Vite, TailwindCSS
- **Routing**: React Router 6 (NOT Next.js, NOT Remix)
- **UI**: shadcn/ui, Lucide React icons
- **State**: React Query for server state, Context for UI state
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Testing**: Playwright for E2E

### When suggesting code:
1. Use TypeScript (not JavaScript)
2. Use React functional components (not class components)
3. Use React Query hooks (not fetch or axios directly)
4. Use shadcn/ui components (not MUI, not Ant Design)
5. Use Lucide icons (not Font Awesome, not Heroicons)

---

## 📝 Code Style Guidelines

### Import Order
```typescript
// 1. React & React ecosystem
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// 2. UI components (shadcn)
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// 3. Icons
import { Plus, Edit, Trash } from 'lucide-react';

// 4. Custom hooks & contexts
import { useAuth } from '@/hooks/useAuth';
import { useProducts } from '@/hooks/useProducts';

// 5. Types
import { Product } from '@/hooks/useProducts';

// 6. Utils
import { cn } from '@/lib/utils';
```

### Component Structure
```typescript
export const MyComponent = ({ prop1, prop2 }: Props) => {
  // 1. Hooks (in order: state, context, query, callbacks, effects)
  const [localState, setLocalState] = useState('');
  const { user } = useAuth();
  const { data, loading } = useQuery(...);
  const handleClick = useCallback(() => {}, []);
  useEffect(() => {}, []);

  // 2. Derived values (memoized)
  const filtered = useMemo(() => {}, [data, localState]);

  // 3. Early returns (loading, error, empty)
  if (loading) return <Skeleton />;
  if (!data) return <EmptyState />;

  // 4. Main render
  return <div>...</div>;
};
```

### Naming Conventions
- **Components**: PascalCase (`ProductCard`, `RecipeDialog`)
- **Hooks**: camelCase with `use` prefix (`useProducts`, `useRecipes`)
- **Functions**: camelCase (`handleClick`, `fetchProducts`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_ITEMS`, `API_URL`)
- **Types/Interfaces**: PascalCase (`Product`, `Recipe`)

---

## 🎨 Design Patterns

### Apple/Notion UI Aesthetic

Use consistent Apple/Notion-inspired styling for a clean, professional appearance:

#### Typography Scale
```typescript
text-[17px] font-semibold  // Dialog titles
text-[15px]                // Subtitles
text-[14px] font-medium    // Body text, list items
text-[13px]                // Secondary text
text-[12px] font-medium text-muted-foreground uppercase tracking-wider  // Form labels
text-[11px]                // Small badges
```

#### Dialog Headers (Icon Box Pattern)
```typescript
<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
  <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
        <Icon className="h-5 w-5 text-foreground" />
      </div>
      <div>
        <DialogTitle className="text-[17px] font-semibold">Title</DialogTitle>
        <p className="text-[13px] text-muted-foreground mt-0.5">Description</p>
      </div>
    </div>
  </DialogHeader>
</DialogContent>
```

#### Form Inputs
```typescript
// Labels (ALWAYS uppercase tracking)
<Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
  Field Name
</Label>

// Inputs
<Input className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg" />
```

#### Buttons
```typescript
// Primary
className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"

// Ghost/Secondary
className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
```

#### Apple-Style Underline Tabs
```typescript
<button
  className={`relative px-0 py-3 mr-6 text-[14px] font-medium ${
    isActive ? 'text-foreground' : 'text-muted-foreground'
  }`}
>
  Tab Label
  {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
</button>
```

#### Cards & Containers
```typescript
// List card with hover state
className="group p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"

// Form section with header
<div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
  <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
    <h3 className="text-[13px] font-semibold">Section Title</h3>
  </div>
  <div className="p-4 space-y-4">{/* Content */}</div>
</div>
```

#### Common Patterns
- `border-border/40` for subtle borders
- `bg-muted/30` for subtle backgrounds
- `rounded-lg` for inputs/buttons, `rounded-xl` for cards
- `opacity-0 group-hover:opacity-100` for hover-reveal actions
- `Switch className="data-[state=checked]:bg-foreground"` for dark toggles

### 1. Headers
```typescript
<Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
  <CardHeader>
    <div className="flex items-center gap-3">
      <Icon className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
      <div>
        <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Title
        </CardTitle>
        <CardDescription>Subtitle</CardDescription>
      </div>
    </div>
  </CardHeader>
</Card>
```

### 2. Status Badges
```typescript
<Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
  <CheckCircle className="w-3 h-3 mr-1" />
  Active
</Badge>
```

### 3. Loading States
```typescript
// Use skeleton screens, not spinners
if (loading) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
```

### 4. Empty States
```typescript
if (!items?.length) {
  return (
    <Card className="bg-gradient-to-br from-muted/50 to-transparent">
      <CardContent className="py-12 text-center">
        <Icon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No items found</h3>
        <p className="text-muted-foreground mb-4">Get started by creating your first item.</p>
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Item
        </Button>
      </CardContent>
    </Card>
  );
}
```

---

## 🔄 Data Fetching Patterns

### React Query Configuration
```typescript
// In custom hooks
export const useProducts = (restaurantId: string | null) => {
  const { data, loading, error, refetch } = useQuery({
    queryKey: ['products', restaurantId],
    queryFn: () => fetchProducts(restaurantId),
    enabled: !!restaurantId, // Don't fetch without restaurantId
    staleTime: 30000, // 30 seconds (max 60s)
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return { products: data || [], loading, error, refetch };
};
```

### Mutations with Optimistic Updates
```typescript
const { mutate } = useMutation({
  mutationFn: updateProduct,
  onMutate: async (newProduct) => {
    await queryClient.cancelQueries(['products']);
    const previous = queryClient.getQueryData(['products']);
    queryClient.setQueryData(['products'], (old) => 
      old?.map(p => p.id === newProduct.id ? newProduct : p)
    );
    return { previous };
  },
  onError: (err, _, context) => {
    queryClient.setQueryData(['products'], context.previous);
    toast({ title: 'Error updating product', variant: 'destructive' });
  },
  onSettled: () => {
    queryClient.invalidateQueries(['products']);
  },
});
```

---

## ♿ Accessibility Checklist

When writing components, ensure:

- [ ] All buttons have `aria-label` if no visible text
- [ ] Form inputs have associated `<label>` or `aria-label`
- [ ] Interactive elements are keyboard accessible (Enter/Space)
- [ ] Focus is managed in modals/dialogs
- [ ] Loading states announced with `aria-live="polite"`
- [ ] Color contrast meets WCAG AA (4.5:1 for text)
- [ ] Icons have `aria-hidden="true"` if decorative
- [ ] Links have descriptive text (not "click here")

---

## 🚫 Common Mistakes to Avoid

### 1. Direct Database Queries in Components
```typescript
// ❌ WRONG
const MyComponent = () => {
  const [data, setData] = useState([]);
  useEffect(() => {
    supabase.from('products').select('*').then(setData);
  }, []);
};

// ✅ CORRECT - Use custom hook
const MyComponent = () => {
  const { products } = useProducts(restaurantId);
};
```

### 2. Missing Null Checks
```typescript
// ❌ WRONG
<div>{user.name}</div>

// ✅ CORRECT
<div>{user?.name || 'Unknown'}</div>
```

### 3. Inline Styles
```typescript
// ❌ WRONG
<div style={{ color: 'red', fontSize: 16 }}>

// ✅ CORRECT
<div className="text-destructive text-base">
```

### 4. Console Logs in Production
```typescript
// ❌ WRONG
console.log('User data:', user);

// ✅ CORRECT - Remove or use debug flag
if (import.meta.env.DEV) {
  console.log('User data:', user);
}
```

---

## 📋 Pull Request Checklist

Before suggesting code, verify:

- [ ] TypeScript types defined (no `any` unless justified)
- [ ] Loading and error states handled
- [ ] Accessibility attributes present
- [ ] No direct colors (semantic tokens only)
- [ ] No manual caching (React Query only)
- [ ] Memoization for expensive calculations
- [ ] No console.logs
- [ ] Imports organized correctly
- [ ] Component follows structure guidelines

---

## 🧪 Testing Guidelines (MANDATORY)

> ⚠️ **All new code must have corresponding tests. PRs without tests will not be merged.**

### Test Requirements by Code Type

| Code Type | Test Location | Required |
|-----------|---------------|----------|
| Utility functions | `tests/unit/*.test.ts` | ✅ Yes |
| Custom hooks | `tests/unit/*.test.ts` | ✅ Yes |
| Business logic | `tests/unit/*.test.ts` | ✅ Yes |
| SQL functions | `supabase/tests/*.sql` | ✅ Yes |
| SQL migrations with logic | `supabase/tests/*.sql` | ✅ Yes |
| UI-only components | - | ❌ Optional |
| Type definitions | - | ❌ Not needed |

### Running Tests

```bash
# TypeScript unit tests
npm run test                    # Watch mode
npm run test -- --run           # Single run
npm run test:coverage           # With coverage

# SQL/Database tests (requires Docker)
cd supabase/tests && ./run_tests.sh

# Full CI check
npm run test -- --run && cd supabase/tests && ./run_tests.sh
```

### Test File Naming

```
src/lib/calculateTax.ts        → tests/unit/calculateTax.test.ts
src/hooks/useProducts.tsx      → tests/unit/useProducts.test.ts
supabase/migrations/*_foo.sql  → supabase/tests/*_foo.sql
```

### Example: TypeScript Test
```typescript
import { describe, it, expect } from 'vitest';
import { calculateTax } from '@/lib/calculateTax';

describe('calculateTax', () => {
  it('calculates tax correctly', () => {
    expect(calculateTax(100, 0.08)).toBe(8);
  });

  it('handles zero amount', () => {
    expect(calculateTax(0, 0.08)).toBe(0);
  });
});
```

### Example: SQL Test (pgTAP)
```sql
-- Test: my_function calculates correctly
SELECT plan(2);

SELECT is(
  my_function(100),
  expected_result,
  'my_function returns expected value'
);

SELECT ok(
  my_function(0) = 0,
  'my_function handles zero input'
);

SELECT * FROM finish();
```

### When to Add Tests (Checklist)

Before submitting code, verify:
- [ ] New functions have unit tests
- [ ] New hooks have unit tests  
- [ ] Edge cases are covered (null, empty, boundary values)
- [ ] Error paths are tested
- [ ] SQL functions have pgTAP tests
- [ ] All tests pass locally

---

## 💡 When in Doubt

1. **Check existing code** - Follow patterns already in use
2. **Prioritize correctness** over cleverness
3. **Ask for clarification** - Don't assume requirements
4. **Keep it simple** - Avoid over-engineering
5. **Think security** - RLS enforced, validate inputs

---

## 📚 Quick Reference

### Common Components
- Button: `<Button variant="default|outline|ghost">`
- Card: `<Card>`, `<CardHeader>`, `<CardContent>`
- Dialog: `<Dialog>`, `<DialogContent>`, `<DialogHeader>`
- Input: `<Input type="text" />`
- Select: `<Select>`, `<SelectTrigger>`, `<SelectContent>`
- Badge: `<Badge variant="default|outline|destructive">`
- Toast: `toast({ title, description, variant })`

### Common Hooks
- Auth: `useAuth()` → `{ user, loading }`
- Restaurant: `useRestaurantContext()` → `{ selectedRestaurant }`
- Products: `useProducts(restaurantId)` → `{ products, loading }`
- Recipes: `useRecipes(restaurantId)` → `{ recipes, loading }`
- Toast: `useToast()` → `{ toast }`

### Common Utils
- Class names: `cn('base-class', condition && 'conditional')`
- Date formatting: `format(date, 'yyyy-MM-dd')`

---

## 🎓 Learning Resources

If you need to suggest unfamiliar patterns, reference:
- [React Query Docs](https://tanstack.com/query/latest)
- [shadcn/ui Components](https://ui.shadcn.com/docs/components)
- [Supabase Docs](https://supabase.com/docs)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

---

## 🔌 Integration Patterns

### Bank Connections (Stripe Financial Connections)

When working with bank integrations:

```typescript
// ✅ CORRECT - Use hook pattern
const { createFinancialConnectionsSession, syncTransactions } = 
  useStripeFinancialConnections(restaurantId);

// Create session for user
const session = await createFinancialConnectionsSession();
// User completes OAuth flow in Stripe UI
// Then sync transactions
await syncTransactions(bankId);
```

**Rules**:
- ❌ NEVER store bank credentials in database
- ✅ ALWAYS use Stripe for credential storage
- ✅ ALWAYS verify webhook signatures
- ✅ Use background jobs for bulk transaction syncs (>1000)

### POS Integrations (Square, Clover)

Use the **Adapter Pattern** for all POS integrations:

```typescript
// ✅ CORRECT - Use adapter abstraction
const adapter = useSquareSalesAdapter(restaurantId);
const sales = await adapter.fetchSales(restaurantId, startDate, endDate);
await adapter.syncToUnified(restaurantId);

// ❌ WRONG - Don't query POS-specific tables directly in UI
const { data } = await supabase.from('square_orders').select('*');
```

**Adapter Interface** (from `types/pos.ts`):
```typescript
interface POSAdapter {
  system: POSSystemType;
  isConnected: boolean;
  fetchSales: (restaurantId: string, startDate?: string, endDate?: string) => Promise<UnifiedSaleItem[]>;
  syncToUnified: (restaurantId: string) => Promise<number>;
  getIntegrationStatus: () => POSIntegrationStatus;
}
```

**Rules**:
- ✅ ALWAYS write to `unified_sales` table
- ✅ ALWAYS encrypt OAuth tokens using encryption service
- ✅ Store raw POS data in `raw_data` JSONB field
- ✅ Implement both webhooks + polling for sync
- ❌ NEVER hardcode POS-specific logic in UI components

### AI Functionality (OpenRouter)

All AI features use OpenRouter with **multi-model fallback**:

```typescript
// ✅ CORRECT - Edge function handles fallback automatically
const { data, error } = await supabase.functions.invoke(
  'ai-categorize-transactions',
  { body: { restaurantId } }
);

// AI suggestion stored separately from final categorization
// User must approve AI suggestions
```

**AI Edge Functions Pattern**:
1. Try free models first (Llama 4 Free, Gemma 3 Free)
2. Fall back to paid models (Gemini, Claude, GPT)
3. Return structured JSON with validation
4. Handle errors gracefully

**Rules**:
- ✅ ALWAYS validate AI output before using
- ✅ Store AI suggestions separately (user must approve)
- ✅ Use `suggested_category_id` not `category_id` for AI suggestions
- ❌ NEVER auto-apply AI changes without user confirmation
- ❌ NEVER send sensitive data (PII, credentials) to AI

### Supabase Patterns

**React Query (Recommended)**:
```typescript
// ✅ CORRECT - Modern pattern
const { data: products, isLoading, error } = useQuery({
  queryKey: ['products', restaurantId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('restaurant_id', restaurantId);
    if (error) throw error;
    return data;
  },
  enabled: !!restaurantId,
  staleTime: 30000,           // 30s for critical data
  refetchOnWindowFocus: true,
  refetchOnMount: true,
});
```

**Real-time Subscriptions**:
```typescript
// ✅ For live data that changes frequently
useEffect(() => {
  const channel = supabase
    .channel(`data-${restaurantId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'bank_transactions',
      filter: `restaurant_id=eq.${restaurantId}`
    }, () => {
      queryClient.invalidateQueries({ queryKey: ['transactions', restaurantId] });
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [restaurantId]);
```

**Edge Function Invocation**:
```typescript
// ✅ For operations requiring secrets or third-party APIs
const { data, error } = await supabase.functions.invoke(
  'square-sync-data',
  { body: { restaurantId } }
);
```

**Rules**:
- ✅ Use React Query for all data fetching
- ✅ Set `staleTime` 30-60s for critical data
- ✅ Use real-time subscriptions for live data
- ✅ Invalidate React Query cache after mutations
- ✅ Always filter by `restaurant_id`
- ❌ NEVER query without restaurant filter
- ❌ NEVER use `staleTime` > 60s for critical data

### Edge Functions

**Standard Pattern**:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Authenticate
    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    // 2. Verify permissions (service role bypasses RLS!)
    const { restaurantId } = await req.json();
    const { data: userRestaurant } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (!userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied');
    }

    // 3. Business logic
    const result = await performOperation();

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

**Rules**:
- ✅ Handle OPTIONS (CORS)
- ✅ Authenticate user
- ✅ Verify permissions (service role bypasses RLS)
- ✅ Use try-catch
- ✅ Return consistent JSON
- ✅ Use `getEncryptionService()` for sensitive data
- ❌ NEVER expose secrets in responses
- ❌ NEVER skip permission checks

---

## 📐 Unit Conversion System (CRITICAL)

The inventory deduction system converts between recipe units and purchase units. **This is critical for inventory accuracy.**

> ⚠️ **The SQL function is authoritative** - TypeScript is for preview only. Both must use identical constants.

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/enhancedUnitConversion.ts` | Client-side preview |
| `supabase/migrations/*_inventory_*.sql` | **Authoritative** server-side |
| `tests/unit/crossValidation.test.ts` | Alignment validation |
| `docs/UNIT_CONVERSIONS.md` | Full documentation |

### ⚠️ Critical: `oz` vs `fl oz`
```typescript
// ❌ WRONG - Using 'oz' for liquids
{ unit: 'oz', product: 'Vodka' }  // Will use weight conversion (28.35g)!

// ✅ CORRECT - Using 'fl oz' for liquids
{ unit: 'fl oz', product: 'Vodka' }  // Will use volume conversion (29.57ml)
```

### Conversion Constants (MUST match SQL)
```typescript
// Volume (to ml)
'fl oz': 29.5735,  // Fluid ounces (liquids)
'cup':   236.588,
'tbsp':  14.7868,
'tsp':   4.92892,
'L':     1000,
'gal':   3785.41,

// Weight (to g)
'oz':    28.3495,  // Weight ounces (solids)
'lb':    453.592,
'kg':    1000,

// Densities (g/cup)
'rice':   185,
'flour':  120,
'sugar':  200,
'butter': 227,
```

### When Modifying Conversions
1. Update **both** TypeScript and SQL with identical values
2. Add tests in `crossValidation.test.ts` and `08_inventory_deduction_conversions.sql`
3. Run both test suites to verify alignment:
   ```bash
   npm run test -- tests/unit/crossValidation.test.ts
   npm run test:db
   ```

### Common Patterns
```typescript
// Container unit (bottle, can, etc.)
// Uses size_value and size_unit to determine content
Product: { uom_purchase: 'bottle', size_value: 750, size_unit: 'ml' }
Recipe: { quantity: 1.5, unit: 'fl oz' }
→ 1.5 fl oz = 44.36ml → 44.36/750 = 0.059 bottles deducted

// Weight conversion
Product: { uom_purchase: 'box', size_value: 1, size_unit: 'lb' }
Recipe: { quantity: 4, unit: 'oz' }
→ 4 oz = 113.4g → 113.4/453.6 = 0.25 boxes deducted

// Density conversion (volume → weight)
Product: { uom_purchase: 'bag', size_value: 10, size_unit: 'kg', name: 'Rice' }
Recipe: { quantity: 2, unit: 'cup' }
→ 2 cups × 185g/cup = 370g = 0.37kg → 0.37/10 = 0.037 bags deducted
```

### Rules
- ✅ ALWAYS use `fl oz` for liquids, `oz` for weight
- ✅ ALWAYS run both TypeScript and SQL tests after changes
- ✅ ALWAYS check `docs/UNIT_CONVERSIONS.md` for full reference
- ❌ NEVER change constants in one place without the other
- ❌ NEVER add new units without updating both codebases

### Security Rules

**Token Management**:
```typescript
// ✅ ALWAYS encrypt before storing
const encryption = await getEncryptionService();
const encrypted = await encryption.encrypt(accessToken);

// ❌ NEVER store plain text tokens
await supabase.from('connections').insert({
  access_token: accessToken  // WRONG!
});
```

**Webhook Verification**:
```typescript
// ✅ ALWAYS verify signatures
const signature = req.headers.get('x-webhook-signature');
const payload = await req.text();
const computed = createHmac('sha256', SECRET)
  .update(payload)
  .digest('base64');

if (signature !== computed) {
  return new Response('Invalid', { status: 401 });
}
```

**Row Level Security**:
```typescript
// ❌ Client-side checks are NOT security
if (user.role === 'owner') {
  // Delete - NOT SECURE!
}

// ✅ RLS enforced at database
// If no permission, query returns empty/error
await supabase.from('products').delete().eq('id', productId);
```

---

## 🧪 Testing Patterns (MUST FOLLOW)

> All test patterns are defined here. Follow these exactly to avoid import errors and test failures.

### E2E Tests (Playwright)

**Location**: `tests/e2e/*.spec.ts`  
**Runner**: `npm run test:e2e` or `npm run test:e2e -- <file>`  
**Framework**: Playwright with `@playwright/test`

#### Standard E2E Test Pattern
```typescript
import { test, expect, Page } from '@playwright/test';
import { format } from 'date-fns'; // Use for date formatting
import { exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Generate unique test user to avoid conflicts
const generateTestUser = () => {
  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return {
    email: `feature-name-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Feature Test User ${ts}`,
    restaurantName: `Feature Test Restaurant ${ts}`,
  };
};

// Standard signup and restaurant creation
async function signUpAndCreateRestaurant(page: Page, user: ReturnType<typeof generateTestUser>) {
  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  const signupTab = page.getByRole('tab', { name: /sign up/i });
  if (await signupTab.isVisible().catch(() => false)) {
    await signupTab.click();
  }

  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Main St');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

// Create employees using Supabase helpers
async function createEmployees(page: Page, employees: Array<{name: string, email: string, position: string}>) {
  await exposeSupabaseHelpers(page);
  
  return await page.evaluate(async ({ empData }) => {
    const user = await (window as any).__getAuthUser();
    if (!user?.id) throw new Error('No user session');

    const restaurantId = await (window as any).__getRestaurantId(user.id);
    if (!restaurantId) throw new Error('No restaurant');

    const rows = empData.map((emp: any) => ({
      name: emp.name,
      email: emp.email,
      position: emp.position,
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1500,
      is_active: true,
      tip_eligible: true,
    }));

    const inserted = await (window as any).__insertEmployees(rows, restaurantId);
    return inserted;
  }, { empData: employees });
}

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);
    
    const employees = await createEmployees(page, [
      { name: 'Test Employee', email: 'test@test.com', position: 'Server' },
    ]);

    // Test logic here
    await page.goto('/some-page');
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
```

#### E2E Best Practices
- ✅ **ALWAYS** use `generateTestUser()` for unique test data
- ✅ **ALWAYS** import from `'../helpers/e2e-supabase'` (relative path with `..`)
- ✅ **ALWAYS** use `page.getByRole()`, `page.getByLabel()` (accessible selectors)
- ✅ **ALWAYS** clear localStorage/sessionStorage before auth tests
- ✅ **ALWAYS** use regex patterns for flexible text matching: `/sign up|create account/i`
- ✅ **ALWAYS** set reasonable timeouts: `{ timeout: 10000 }`
- ❌ **NEVER** import from `'./helpers'` or `'@/`' in E2E tests (causes module errors)
- ❌ **NEVER** hardcode test data that could conflict with other tests
- ❌ **NEVER** use `data-testid` unless absolutely necessary (prefer semantic selectors)

---

### Unit Tests (Vitest)

**Location**: `tests/unit/*.test.ts` or `tests/unit/*.test.tsx`  
**Runner**: `npm run test` (watch mode) or `npm run test -- --run` (single run)  
**Framework**: Vitest with `jsdom` environment

#### Standard Unit Test Pattern
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { functionToTest, type TypeToUse } from '@/path/to/module';

describe('Module Name - Feature Description', () => {
  // Setup before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('functionToTest', () => {
    it('should handle normal case', () => {
      const result = functionToTest(input);
      expect(result).toBe(expectedOutput);
    });

    it('should handle edge case: empty input', () => {
      const result = functionToTest([]);
      expect(result).toEqual(expectedEmptyResult);
    });

    it('should handle edge case: null values', () => {
      const result = functionToTest(null);
      expect(result).toBe(null);
    });

    it('CRITICAL: should prevent specific bug', () => {
      // Document critical business logic with CRITICAL prefix
      const result = functionToTest(criticalInput);
      expect(result).not.toBe(buggyOutput);
      expect(result).toBe(correctOutput);
    });
  });
});
```

#### Testing React Hooks Pattern
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCustomHook } from '@/hooks/useCustomHook';

describe('useCustomHook', () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };

  it('should fetch data correctly', async () => {
    const { result } = renderHook(() => useCustomHook('test-id'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeDefined();
  });
});
```

#### Unit Test Best Practices
- ✅ **ALWAYS** use path alias `@/` for src imports
- ✅ **ALWAYS** test edge cases: empty, null, undefined, zero, negative
- ✅ **ALWAYS** use descriptive test names: "should [expected behavior] when [condition]"
- ✅ **ALWAYS** prefix critical business logic tests with "CRITICAL:"
- ✅ **ALWAYS** mock external dependencies (Supabase, API calls)
- ✅ **ALWAYS** clear mocks in `beforeEach`
- ❌ **NEVER** test implementation details - test behavior
- ❌ **NEVER** write tests that depend on execution order
- ❌ **NEVER** use `any` type in test data - use proper types

---

### Database Tests (pgTAP)

**Location**: `supabase/tests/*.sql`  
**Runner**: `cd supabase/tests && ./run_tests.sh`  
**Framework**: pgTAP (PostgreSQL testing framework)

#### Standard Database Test Pattern
```sql
-- File: supabase/tests/05_feature_name.sql
-- Description: Tests for feature_name function/trigger/migration

BEGIN;
SELECT plan(10); -- Number of tests in file

-- Setup: Disable RLS and create test data
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;

-- Create test data
INSERT INTO restaurants (id, name) VALUES
  ('test-id-1', 'Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, restaurant_id, name, current_stock) VALUES
  ('prod-1', 'test-id-1', 'Test Product', 10)
ON CONFLICT (id) DO UPDATE SET current_stock = 10;

-- ============================================================
-- TEST CATEGORY 1: Normal Operations
-- ============================================================

-- Test 1: Function succeeds with valid input
SELECT lives_ok(
  $$SELECT my_function('test-id-1', 'param')$$,
  'Function should succeed with valid input'
);

-- Test 2: Function returns expected result
SELECT is(
  (SELECT my_function('test-id-1', 'param')),
  'expected_result',
  'Function should return expected result'
);

-- Test 3: Database state updated correctly
SELECT is(
  (SELECT current_stock FROM products WHERE id = 'prod-1'),
  9.0::numeric,
  'Stock should be decremented: 10 - 1 = 9'
);

-- ============================================================
-- TEST CATEGORY 2: Edge Cases
-- ============================================================

-- Test 4: Function handles null input
SELECT throws_ok(
  $$SELECT my_function(NULL, 'param')$$,
  'Function should reject NULL restaurant_id'
);

-- Test 5: Function handles zero values
SELECT is(
  (SELECT my_function('test-id-1', 0)),
  0,
  'Function should handle zero input'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
```

#### Database Test Best Practices
- ✅ **ALWAYS** use `BEGIN;` at start and `ROLLBACK;` at end (isolate tests)
- ✅ **ALWAYS** call `SELECT plan(N);` with exact test count
- ✅ **ALWAYS** end with `SELECT * FROM finish();`
- ✅ **ALWAYS** disable RLS for test tables
- ✅ **ALWAYS** use `ON CONFLICT ... DO UPDATE` for idempotent inserts
- ✅ **ALWAYS** cast numeric comparisons: `9.0::numeric`
- ✅ **ALWAYS** group related tests with comment headers
- ✅ **ALWAYS** test both success and failure cases
- ✅ Use `lives_ok()` for "should not throw"
- ✅ Use `throws_ok()` for "should throw error"
- ✅ Use `is()` for exact equality
- ✅ Use `ok()` for boolean conditions
- ❌ **NEVER** leave database in dirty state (always ROLLBACK)
- ❌ **NEVER** assume data from previous tests exists

#### Running Database Tests
```bash
# Run all tests
cd supabase/tests && ./run_tests.sh

# Run specific test file
cd supabase/tests && ./run_tests.sh 05_feature_name.sql

# View detailed output
cd supabase/tests && ./run_tests.sh --verbose
```

---

### Test Coverage Requirements

| Code Type | Required Coverage | Test Type |
|-----------|------------------|-----------|
| Utility functions (`src/lib/`, `src/utils/`) | 85%+ | Unit tests |
| Custom hooks (`src/hooks/`) | 80%+ | Unit tests |
| Business logic | 90%+ | Unit + Integration |
| SQL functions | 100% | Database tests |
| Critical features (payments, inventory) | 95%+ | All types |
| UI components | Optional | Visual/snapshot |

### Running All Tests
```bash
# TypeScript unit tests (watch mode)
npm run test

# TypeScript unit tests (single run)
npm run test -- --run

# Unit tests with coverage
npm run test:coverage

# E2E tests (all)
npm run test:e2e

# E2E tests (specific file)
npm run test:e2e -- tests/e2e/feature.spec.ts

# Database tests (requires Supabase running)
cd supabase/tests && ./run_tests.sh

# Full CI test suite
npm run test -- --run && npm run test:e2e && cd supabase/tests && ./run_tests.sh
```

---

## ⚡ Performance Optimization Patterns

### List Virtualization (Large Datasets)

When rendering lists with 100+ items, use virtualization to maintain 60fps scrolling:

```typescript
import { useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualizedList({ items }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,  // Initial estimate
    overscan: 10,            // Render 10 extra items above/below viewport
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={item.id}                    // ✅ Use stable ID, NOT virtualRow.index
              data-index={virtualRow.index}    // ✅ Required for measureElement
              ref={virtualizer.measureElement} // ✅ Dynamic height measurement
              style={{
                position: 'absolute',
                top: 0,
                transform: `translateY(${virtualRow.start}px)`,
                width: '100%',
              }}
            >
              <MemoizedRow item={item} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Key rules:**
- ✅ Use `key={item.id}` (stable identifier), NOT `key={virtualRow.index}`
- ✅ Use `data-index={virtualRow.index}` for virtualization tracking
- ✅ Use `measureElement` for variable row heights
- ✅ Use `div` layout, NOT `<table>` (tables don't virtualize well)
- ❌ NEVER use fixed row heights if content varies (causes white spaces/overlap)

### Memoization for Row Components

```typescript
import { memo } from 'react';

interface RowProps {
  item: Item;
  displayValues: DisplayValues;  // Pre-computed values
  onAction: (id: string) => void;  // MUST be stable (useCallback)
}

export const MemoizedRow = memo(function MemoizedRow({
  item,
  displayValues,
  onAction,
}: RowProps) {
  // NO hooks inside - all data passed as props
  return <div>...</div>;
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when these change
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.displayValues === nextProps.displayValues  // By reference
  );
});
```

**Key rules:**
- ✅ NO hooks inside memoized components
- ✅ Pre-compute display values in parent (useMemo)
- ✅ Pass stable callbacks (useCallback)
- ✅ Custom comparison function for fine-grained control

### Stabilizing Callbacks and Derived Data

```typescript
// In parent component
const categorize = useCategorizeTransaction();

// ✅ Pre-compute display values (MUST use useMemo)
const displayValuesMap = useMemo(() => {
  const map = new Map<string, DisplayValues>();
  for (const item of items) {
    map.set(item.id, {
      formattedAmount: formatCurrency(item.amount),
      formattedDate: formatDate(item.date),
    });
  }
  return map;
}, [items]);  // Only recompute when items change

// ✅ Stable callbacks (MUST use useCallback)
const handleAction = useCallback((id: string) => {
  categorize.mutate({ id });
}, [categorize]);

// Pass to memoized row
<MemoizedRow
  item={item}
  displayValues={displayValuesMap.get(item.id)!}
  onAction={handleAction}
/>
```

### Single Dialog Instance Pattern

```typescript
// ❌ WRONG - Dialog per row (1000+ dialog instances)
{items.map(item => (
  <Row key={item.id} item={item}>
    <Dialog open={openId === item.id}>...</Dialog>
  </Row>
))}

// ✅ CORRECT - Single dialog at list level
const [activeItem, setActiveItem] = useState<Item | null>(null);
const [dialogType, setDialogType] = useState<'edit' | 'delete' | null>(null);

// Rows just trigger dialog open
<MemoizedRow onEdit={() => { setActiveItem(item); setDialogType('edit'); }} />

// Single dialog instance
{activeItem && dialogType === 'edit' && (
  <EditDialog item={activeItem} onClose={() => setDialogType(null)} />
)}
```

### Query Optimization

```typescript
// ❌ WRONG - Select everything
.from('transactions').select('*')

// ✅ CORRECT - Select only needed fields
.from('transactions').select(`
  id, date, amount, description, status,
  category:categories(id, name)
`)

// ❌ WRONG - Fetch related data always
.select('*, raw_data, bank_account_balances(*)')

// ✅ CORRECT - Fetch heavy data only when needed (detail view)
const { data: fullDetails } = useQuery({
  queryKey: ['transaction-full', id],
  queryFn: () => fetchFullDetails(id),
  enabled: !!id && isDetailOpen,  // Only fetch when dialog opens
});
```

### Mobile Virtualization Decision

Mobile views with 3-5 visible items generally don't need virtualization:
- Touch scrolling can feel "jumpy" with virtualization
- Variable card heights complicate virtualization
- Pagination/infinite scroll already limits DOM nodes

**Use virtualization on mobile only if:**
- 500+ items visible in single scroll
- Scroll performance drops below 30fps

### Performance Checklist

- [ ] Lists with 100+ items use virtualization
- [ ] Virtualized keys use stable IDs, not indices
- [ ] Row components are memoized with custom comparison
- [ ] Callbacks passed to rows use useCallback
- [ ] Display values pre-computed with useMemo
- [ ] Single dialog instance pattern (not per-row)
- [ ] Queries select only needed fields
- [ ] Heavy data deferred until needed (detail views)

---

## 📚 Integration Documentation

For detailed integration patterns and best practices, see:
- **[INTEGRATIONS.md](../INTEGRATIONS.md)** - Comprehensive integration guide
  - Bank connections (Stripe Financial Connections)
  - POS systems (Square, Clover adapter pattern)
  - AI functionality (OpenRouter multi-model fallback)
  - Supabase patterns (React Query, real-time, Edge Functions)
  - Security best practices
  - Performance optimization
- **[docs/UNIT_CONVERSIONS.md](../docs/UNIT_CONVERSIONS.md)** - Unit conversion system
  - Volume and weight conversion constants
  - Product-specific densities (rice, flour, sugar, butter)
  - Container unit handling (bottles, cans, bags)
  - TypeScript ↔ SQL alignment requirements

---

**Remember**: This system manages real restaurants with real inventory and money. Correctness and reliability are more important than clever code.
