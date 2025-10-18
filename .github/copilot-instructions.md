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

**Remember**: This system manages real restaurants with real inventory and money. Correctness and reliability are more important than clever code.
