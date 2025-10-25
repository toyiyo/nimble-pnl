# GitHub Copilot Instructions

> Instructions for AI coding assistants working on this restaurant management system.

## 🎯 Project Context

This is a **real-time restaurant management system** handling inventory, recipes, sales, and P&L. Data accuracy is critical - stale data can cause stock-outs, incorrect financials, and operational issues.

---

## ⚠️ Critical Rules - READ FIRST

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

## 🧪 Testing Guidelines

### When to suggest tests:
1. **Business logic** (calculations, validations)
2. **Custom hooks** (data transformations)
3. **Critical user flows** (auth, checkout, inventory updates)

### When NOT to suggest tests:
1. **UI-only components** (presentational)
2. **Simple wrappers**
3. **Type definitions**

### Example Test
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useProducts } from '@/hooks/useProducts';

describe('useProducts', () => {
  it('fetches products for restaurant', async () => {
    const { result } = renderHook(() => useProducts('restaurant-123'));
    
    await waitFor(() => expect(result.current.loading).toBe(false));
    
    expect(result.current.products).toHaveLength(5);
  });
});
```

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

## 📚 Integration Documentation

For detailed integration patterns and best practices, see:
- **[INTEGRATIONS.md](../INTEGRATIONS.md)** - Comprehensive integration guide
  - Bank connections (Stripe Financial Connections)
  - POS systems (Square, Clover adapter pattern)
  - AI functionality (OpenRouter multi-model fallback)
  - Supabase patterns (React Query, real-time, Edge Functions)
  - Security best practices
  - Performance optimization

---

**Remember**: This system manages real restaurants with real inventory and money. Correctness and reliability are more important than clever code.
