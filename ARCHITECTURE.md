# Architecture & Technical Guidelines

## 🏗️ Technology Stack

### Frontend
- **React 18.3+** - UI library with concurrent features
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server
- **React Router 6** - Client-side routing
- **TailwindCSS** - Utility-first styling
- **shadcn/ui** - Accessible component library
- **Lucide React** - Icon library

### Backend & Database
- **Supabase** - PostgreSQL database, Auth, Storage, Edge Functions
- **Row Level Security (RLS)** - Database-level authorization
- **PostgreSQL Functions** - Server-side business logic
- **Edge Functions (Deno)** - Serverless API endpoints

### State Management & Data Fetching
- **React Query (@tanstack/react-query)** - Server state management
- **React Context** - Global UI state (restaurant selection, auth)
- **React Hooks** - Local component state

---

## 🔄 Caching & Performance Strategy

### ⚠️ Critical: Data Freshness First

**This is a real-time restaurant management system** where inventory counts, sales data, and P&L must be accurate. Stale data can lead to:
- Incorrect inventory counts
- Missing sales
- Wrong financial reports
- Stock-outs or over-ordering

### ✅ Approved Caching Techniques

#### 1. **React Memoization** (Component-level optimization)
```typescript
// Memoize expensive calculations
const sortedProducts = useMemo(() => {
  return products
    .filter(p => p.name.includes(searchTerm))
    .sort((a, b) => a.name.localeCompare(b.name));
}, [products, searchTerm]); // Only recalculate when dependencies change

// Memoize callback functions
const handleSearch = useCallback((term: string) => {
  setSearchTerm(term);
}, []); // Stable function identity

// Memoize entire components
const ProductCard = memo(({ product }) => {
  return <Card>...</Card>;
}, (prev, next) => prev.product.id === next.product.id);
```

**Why it's safe**: Calculations run on current data, no risk of stale data.

#### 2. **React Query Configuration** (Short-term, smart caching)
```typescript
// In hooks/useProducts.tsx
const { data: products } = useQuery({
  queryKey: ['products', restaurantId],
  queryFn: () => fetchProducts(restaurantId),
  staleTime: 30000, // 30 seconds - data considered fresh
  cacheTime: 300000, // 5 minutes - keep in cache for quick return
  refetchOnWindowFocus: true, // Always check when user returns
  refetchOnMount: true, // Check when component mounts
});
```

**Configuration Rules:**
- `staleTime`: 0-60 seconds (default: 30s)
- `cacheTime`: 5 minutes max
- Always `refetchOnWindowFocus: true`
- Always `refetchOnMount: true` for critical data

**Why it's safe**: Short stale time means fresh data, automatic refetch prevents stale views.

#### 3. **Debouncing User Input** (UX optimization)
```typescript
// Prevent excessive API calls
const debouncedSearch = useMemo(
  () => debounce((term: string) => {
    // API call here
  }, 300),
  []
);
```

**Why it's safe**: Only delays API calls, doesn't cache results.

#### 4. **Virtual Scrolling** (Performance for long lists)
```typescript
// Only render visible items
import { useVirtualizer } from '@tanstack/react-virtual';

const rowVirtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 100,
});
```

**Why it's safe**: Renders subset of actual data, no caching involved.

#### 5. **Optimistic Updates** (UX improvement)
```typescript
const { mutate } = useMutation({
  mutationFn: updateProduct,
  onMutate: async (newProduct) => {
    // Cancel outgoing queries
    await queryClient.cancelQueries(['products']);
    
    // Snapshot previous value
    const previous = queryClient.getQueryData(['products']);
    
    // Optimistically update
    queryClient.setQueryData(['products'], (old) => 
      old.map(p => p.id === newProduct.id ? newProduct : p)
    );
    
    return { previous }; // Return rollback context
  },
  onError: (err, newProduct, context) => {
    // Rollback on error
    queryClient.setQueryData(['products'], context.previous);
  },
  onSettled: () => {
    // Always refetch to ensure correctness
    queryClient.invalidateQueries(['products']);
  },
});
```

**Why it's safe**: Immediate UI update, automatic rollback on failure, always refetches for accuracy.

### ❌ Prohibited Caching Techniques

1. **Manual localStorage/sessionStorage for data**
   ```typescript
   // ❌ NEVER DO THIS
   localStorage.setItem('products', JSON.stringify(products));
   
   // ❌ NEVER DO THIS
   const cachedProducts = localStorage.getItem('products');
   ```
   **Why dangerous**: No invalidation strategy, users see stale data.

2. **Long staleTime (>60s) for critical data**
   ```typescript
   // ❌ NEVER DO THIS
   staleTime: 600000, // 10 minutes - TOO LONG
   ```
   **Why dangerous**: Inventory/sales could change, user sees old data.

3. **Module-level caching**
   ```typescript
   // ❌ NEVER DO THIS
   let cachedProducts = null;
   export const getProducts = () => {
     if (!cachedProducts) {
       cachedProducts = fetchProducts();
     }
     return cachedProducts;
   };
   ```
   **Why dangerous**: Never invalidates, persists across sessions.

4. **Service Workers for data caching**
   ```typescript
   // ❌ NEVER cache API responses in service workers
   ```
   **Why dangerous**: Hard to invalidate, complex debugging.

---

## 🎨 Design System Guidelines

### Color System (Semantic Tokens Only)

**NEVER use direct colors** like `bg-white`, `text-black`, `border-gray-300`. Always use semantic tokens from `index.css`:

```typescript
// ❌ WRONG
<div className="bg-white text-black border-gray-300">

// ✅ CORRECT
<div className="bg-background text-foreground border-border">
```

**Available Semantic Tokens:**
```css
/* Colors */
--background, --foreground
--card, --card-foreground
--popover, --popover-foreground
--primary, --primary-foreground
--secondary, --secondary-foreground
--muted, --muted-foreground
--accent, --accent-foreground
--destructive, --destructive-foreground
--border, --input, --ring

/* Gradients */
--gradient-primary
--gradient-subtle

/* Shadows */
--shadow-elegant
--shadow-glow
```

### Component Patterns

#### Headers with Gradients
```typescript
<Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
  <CardHeader>
    <div className="flex items-center gap-3">
      <MetricIcon 
        icon={ChefHat} 
        className="text-primary" 
      />
      <div>
        <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Page Title
        </CardTitle>
        <CardDescription>Subtitle here</CardDescription>
      </div>
    </div>
  </CardHeader>
</Card>
```

#### Animated Icons
```typescript
<Icon className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
```

#### Hover Effects
```typescript
// Cards
<Card className="hover:shadow-lg hover:border-primary/30 transition-all duration-300">

// Buttons
<Button className="hover:bg-accent/80 transition-colors">

// Links
<Link className="hover:text-primary hover:underline transition-colors">
```

#### Status Badges
```typescript
<Badge variant="default" className="bg-gradient-to-r from-green-500 to-emerald-600">
  <CheckCircle className="w-3 h-3 mr-1" />
  Active
</Badge>
```

---

## ♿ Accessibility Standards

All components must meet **WCAG 2.1 AA** standards:

### 1. **Keyboard Navigation**
```typescript
// All interactive elements must be keyboard accessible
<button 
  onClick={handleClick}
  onKeyDown={(e) => e.key === 'Enter' && handleClick()}
  tabIndex={0}
>
```

### 2. **ARIA Labels**
```typescript
// Buttons without text
<button aria-label="Close dialog">
  <X className="h-4 w-4" />
</button>

// Form inputs
<Input
  aria-label="Search products"
  aria-describedby="search-hint"
/>
<span id="search-hint" className="sr-only">
  Type to filter products by name
</span>
```

### 3. **Focus Management**
```typescript
// Modal/Dialog opening
useEffect(() => {
  if (isOpen) {
    dialogRef.current?.focus();
  }
}, [isOpen]);

// Returning focus after close
const handleClose = () => {
  setIsOpen(false);
  triggerButtonRef.current?.focus();
};
```

### 4. **Screen Reader Announcements**
```typescript
// For dynamic updates
<div role="status" aria-live="polite" className="sr-only">
  {loading ? 'Loading products...' : `${products.length} products loaded`}
</div>
```

### 5. **Color Contrast**
- Text on background: Minimum 4.5:1 ratio
- Large text (18px+): Minimum 3:1 ratio
- Interactive elements: Minimum 3:1 ratio

Use contrast checker: `https://webaim.org/resources/contrastchecker/`

---

## 📊 State Management Architecture

### When to Use What

#### React Context (Global UI State)
```typescript
// ✅ Use for:
- Selected restaurant (RestaurantContext)
- Auth state (useAuth)
- Theme/preferences

// ❌ Don't use for:
- Server data (products, sales, etc.)
- Computed values
```

#### React Query (Server State)
```typescript
// ✅ Use for:
- All API data (products, recipes, sales)
- Background refetching
- Cache invalidation
- Optimistic updates

// ❌ Don't use for:
- Local UI state (modals, tabs)
- Derived/computed values
```

#### useState/useReducer (Local State)
```typescript
// ✅ Use for:
- Form inputs
- Modal open/close
- Local search/filter terms
- UI-only state

// ❌ Don't use for:
- Data that needs to persist
- Data shared across routes
```

### Data Flow Example

```typescript
// 1. Context provides selected restaurant
const { selectedRestaurant } = useRestaurantContext();

// 2. Hook fetches server data with React Query
const { products, loading } = useProducts(selectedRestaurant?.restaurant_id);

// 3. Component manages local UI state
const [searchTerm, setSearchTerm] = useState('');

// 4. Memoized computation on server data + local state
const filteredProducts = useMemo(() => {
  return products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
}, [products, searchTerm]);
```

---

## 🔒 Security Patterns

### Row Level Security (RLS)

All Supabase tables have RLS enabled. Queries automatically filter by user permissions.

**Example Policy:**
```sql
-- Users can only see products for their restaurants
CREATE POLICY "Users can view products for their restaurants" 
ON products 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = products.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);
```

### Client-side checks

```typescript
// ❌ WRONG - Never rely on client-side checks alone
if (user.role === 'owner') {
  // Delete product - NOT SECURE
}

// ✅ CORRECT - RLS enforced on database
// If user doesn't have permission, Supabase returns error
await supabase.from('products').delete().eq('id', productId);
```

---

## 🧪 Testing Strategy

### Unit Tests (Hooks & Utils)
```typescript
// Test pure functions and hooks
import { renderHook } from '@testing-library/react';
import { useRecipes } from '@/hooks/useRecipes';

test('filters recipes by search term', () => {
  const { result } = renderHook(() => useRecipes(restaurantId));
  // assertions
});
```

### Integration Tests (Components)
```typescript
// Test user interactions
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductCard } from '@/components/ProductCard';

test('opens edit dialog on click', () => {
  render(<ProductCard product={mockProduct} />);
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
```

### E2E Tests (Playwright)
```typescript
// Test complete user flows
test('user can create a recipe', async ({ page }) => {
  await page.goto('/recipes');
  await page.click('text=Create Recipe');
  await page.fill('[name="name"]', 'Test Recipe');
  await page.click('text=Save');
  await expect(page.locator('text=Test Recipe')).toBeVisible();
});
```

---

## 📁 File Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/              # shadcn components
│   └── *.tsx            # Feature components
├── contexts/            # React Context providers
├── hooks/               # Custom React hooks
│   ├── adapters/        # POS system adapters
│   └── *.tsx            # Business logic hooks
├── lib/                 # Utility functions
├── pages/               # Route components
├── services/            # External services (OCR, AI)
├── types/               # TypeScript types
└── utils/               # Helper functions

supabase/
├── functions/           # Edge Functions (Deno)
├── migrations/          # Database migrations
└── tests/               # Database function tests
```

---

## 🚀 Development Workflow

### 1. **Feature Development**
```bash
# 1. Create feature branch
git checkout -b feature/recipe-sorting

# 2. Develop with hot reload
npm run dev

# 3. Check types
npm run type-check

# 4. Run tests
npm run test

# 5. Commit with conventional commits
git commit -m "feat: add recipe sorting by margin"
```

### 2. **Database Changes**
```bash
# 1. Create migration
supabase migration new add_recipe_sorting

# 2. Write SQL in migrations/
# 3. Test locally
supabase db reset

# 4. Deploy
supabase db push
```

### 3. **Code Review Checklist**
- [ ] No direct colors (use semantic tokens)
- [ ] No manual caching (use React Query)
- [ ] Accessibility labels present
- [ ] Loading states handled
- [ ] Error states handled
- [ ] TypeScript types defined
- [ ] No console.logs in production code

---

## 🔌 Integration Architecture

For comprehensive documentation on third-party integrations, see **[INTEGRATIONS.md](INTEGRATIONS.md)**:

### Bank Connections
- **Stripe Financial Connections** for secure bank linking
- OAuth-based authentication (credentials never stored)
- Webhook + polling for real-time transaction sync
- AI-powered categorization

### POS System Integrations
- **Adapter Pattern** for unified POS abstraction
- **Square** (primary) - OAuth, webhooks, periodic sync
- **Clover** (secondary) - OAuth, webhooks, periodic sync
- **Unified Sales Table** - Single source of truth for all POS data

### AI Functionality
- **OpenRouter** with multi-model fallback
- Free models first (Llama 4, Gemma 3)
- Paid models as fallback (Gemini, Claude, GPT)
- Use cases: Transaction categorization, OCR, product enhancement

### Edge Functions
- **Deno runtime** on Supabase
- OAuth flows, webhooks, third-party API calls
- Shared utilities: Encryption service (AES-GCM), CORS headers
- Service role (bypasses RLS) - validate permissions in code

**Key Principles**:
- Security first (encrypt tokens, verify webhooks)
- Adapter pattern for extensibility
- Multi-model fallback for reliability
- Real-time sync with background jobs for bulk operations

---

## 📚 Learning Resources

### React Query
- [Official Docs](https://tanstack.com/query/latest/docs/react/overview)
- [Caching Explained](https://tkdodo.eu/blog/react-query-as-a-state-manager)

### Supabase
- [Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs)
- [RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Edge Functions](https://supabase.com/docs/guides/functions)

### Integrations
- [Stripe Financial Connections](https://stripe.com/docs/financial-connections)
- [Square API](https://developer.squareup.com/docs)
- [OpenRouter API](https://openrouter.ai/docs)

### Accessibility
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [A11y Project](https://www.a11yproject.com/)

### Performance
- [React Performance](https://react.dev/learn/render-and-commit)
- [Web Vitals](https://web.dev/vitals/)
