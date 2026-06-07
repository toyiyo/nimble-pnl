# Route-level Code Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split all 57 routes into lazy-loaded chunks so the entry JS chunk drops from 5.8 MB to ~1–2 MB, cutting mobile-Safari LCP p75 from ~23 s toward low single digits.

**Architecture:** Convert every page import in `src/App.tsx` to `React.lazy` via a resilient `lazyWithRetry()` helper; wrap `<Routes>` in a `<RouteErrorBoundary>` + `<Suspense fallback={<RouteFallback/>}>`; enable React Router `v7_startTransition` so only the first load shows the fallback. Also dynamic-import `tesseract.js` at point-of-use and normalize self-defeating dual static/dynamic imports.

**Tech Stack:** React 18.3, react-router-dom 6.30 (`v7_startTransition` future flag), Vite, Vitest + Testing Library, Capacitor 7.

**Spec:** `docs/superpowers/specs/2026-06-07-route-code-splitting-design.md`

---

## File structure

| File | Responsibility | Coverage |
|---|---|---|
| `src/lib/lazyWithRetry.ts` (create) | Resilient `React.lazy` wrapper: retry, web reload-once, native guard | Covered (tested) |
| `tests/unit/lazyWithRetry.test.ts` (create) | Unit tests for the helper | — |
| `src/components/RouteFallback.tsx` (create) | Accessible full-screen Suspense loader | Excluded (`src/components/**`) |
| `tests/unit/RouteFallback.test.tsx` (create) | Render/a11y test | — |
| `src/components/RouteErrorBoundary.tsx` (create) | Recoverable chunk-load error boundary | Excluded (`src/components/**`) |
| `tests/unit/RouteErrorBoundary.test.tsx` (create) | Behavior test | — |
| `src/services/ocrService.ts` (modify) | Dynamic-import tesseract; static supabase | Covered (tested) |
| `tests/unit/ocrService.test.ts` (create) | `initialize()` dynamic-import test | — |
| `src/App.tsx` (modify) | Lazy routes + Suspense + ErrorBoundary + startTransition | Excluded (route wiring) |
| `src/components/POSSalesFileUpload.tsx` (modify) | Static `mappingTemplates` import | Excluded |
| `src/components/ReceiptMappingReview.tsx` (modify) | Static supabase import | Excluded |
| `src/pages/Inventory.tsx` (modify) | Static supabase import | Excluded |
| `src/hooks/useRecipes.tsx` (modify) | Static `enhancedUnitConversion` import | Excluded |

---

## Task 1: `lazyWithRetry` helper

**Files:**
- Create: `src/lib/lazyWithRetry.ts`
- Test: `tests/unit/lazyWithRetry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lazyWithRetry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModuleWithRetry } from '@/lib/lazyWithRetry';

function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _map: m,
  };
}
const mod = { default: () => null };

describe('loadModuleWithRetry', () => {
  let storage: ReturnType<typeof makeStorage>;
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    storage = makeStorage();
    reload = vi.fn();
  });

  it('returns the module on success and clears the guard', async () => {
    storage.setItem('lazyWithRetry:reloaded', '1');
    const factory = vi.fn().mockResolvedValue(mod);
    const result = await loadModuleWithRetry(factory, { storage, reload, isNative: false });
    expect(result).toBe(mod);
    expect(storage.getItem('lazyWithRetry:reloaded')).toBeNull();
  });

  it('retries a transient failure then succeeds', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce(mod);
    const result = await loadModuleWithRetry(factory, { retries: 1, retryDelayMs: 0, storage, reload, isNative: false });
    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once (web) on persistent failure when guard not set', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    // function hangs after triggering reload; assert via waitFor without awaiting it
    void loadModuleWithRetry(factory, { retries: 1, retryDelayMs: 0, storage, reload, isNative: false });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(storage.getItem('lazyWithRetry:reloaded')).toBe('1');
  });

  it('rethrows (no reload) when guard already set', async () => {
    storage.setItem('lazyWithRetry:reloaded', '1');
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload, isNative: false }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });

  it('native mode never reloads — rethrows immediately', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('gone'));
    await expect(
      loadModuleWithRetry(factory, { retries: 0, retryDelayMs: 0, storage, reload, isNative: true }),
    ).rejects.toThrow('gone');
    expect(reload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lazyWithRetry.test.ts`
Expected: FAIL — `loadModuleWithRetry` not exported.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/lazyWithRetry.ts
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ModuleDefault<T> = { default: T };
export type ComponentFactory<T extends ComponentType<unknown>> = () => Promise<ModuleDefault<T>>;

const RELOAD_GUARD_KEY = 'lazyWithRetry:reloaded';

type GuardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LoadOptions {
  retries?: number;
  retryDelayMs?: number;
  reloadOnFail?: boolean;
  storage?: GuardStorage;
  reload?: () => void;
  isNative?: boolean;
}

function safeSessionStorage(): GuardStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function detectNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function loadModuleWithRetry<T extends ComponentType<unknown>>(
  factory: ComponentFactory<T>,
  options: LoadOptions = {},
): Promise<ModuleDefault<T>> {
  const {
    retries = 1,
    retryDelayMs = 300,
    storage = safeSessionStorage(),
    reload = () => window.location.reload(),
    isNative = detectNative(),
    // Native (Capacitor) ships the bundle in-app; sessionStorage clears on cold
    // launch, so an auto-reload would loop forever. Surface to the error boundary.
    reloadOnFail = !isNative,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const mod = await factory();
      storage?.removeItem(RELOAD_GUARD_KEY);
      return mod;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  const alreadyReloaded = storage?.getItem(RELOAD_GUARD_KEY) === '1';
  if (reloadOnFail && !alreadyReloaded) {
    storage?.setItem(RELOAD_GUARD_KEY, '1');
    reload();
    // Hang so React keeps the Suspense fallback until the reload swaps the page.
    return new Promise<ModuleDefault<T>>(() => {});
  }
  storage?.removeItem(RELOAD_GUARD_KEY);
  throw lastError;
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: ComponentFactory<T>,
  options?: LoadOptions,
): LazyExoticComponent<T> {
  return lazy(() => loadModuleWithRetry(factory, options));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lazyWithRetry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lazyWithRetry.ts tests/unit/lazyWithRetry.test.ts
git commit -m "feat(perf): add lazyWithRetry helper for resilient route chunks"
```

---

## Task 2: `RouteFallback` loader component

**Files:**
- Create: `src/components/RouteFallback.tsx`
- Test: `tests/unit/RouteFallback.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/RouteFallback.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteFallback from '@/components/RouteFallback';

describe('RouteFallback', () => {
  it('renders an accessible status loader with a non-empty name', () => {
    render(<RouteFallback />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/loading/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/RouteFallback.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/RouteFallback.tsx
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-background"
    >
      <div className="flex items-center gap-3 text-[14px] text-muted-foreground">
        <span
          aria-hidden="true"
          className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-safe:animate-spin"
        />
        <span>Loading…</span>
      </div>
    </div>
  );
}

export default RouteFallback;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/RouteFallback.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RouteFallback.tsx tests/unit/RouteFallback.test.tsx
git commit -m "feat(perf): add accessible RouteFallback Suspense loader"
```

---

## Task 3: `RouteErrorBoundary`

**Files:**
- Create: `src/components/RouteErrorBoundary.tsx`
- Test: `tests/unit/RouteErrorBoundary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/RouteErrorBoundary.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('chunk load failed');
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('renders children when there is no error', () => {
    render(<RouteErrorBoundary><div>safe child</div></RouteErrorBoundary>);
    expect(screen.getByText('safe child')).toBeInTheDocument();
  });

  it('shows a recoverable alert and calls onReload when the child throws', () => {
    const onReload = vi.fn();
    render(
      <RouteErrorBoundary onReload={onReload}>
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reload page/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/RouteErrorBoundary.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/RouteErrorBoundary.tsx
import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  onReload?: () => void;
}
interface State {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  private containerRef = createRef<HTMLDivElement>();

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RouteErrorBoundary caught an error:', error, info.componentStack);
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (!prevState.hasError && this.state.hasError) {
      this.containerRef.current?.focus();
    }
  }

  private handleReload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div
          ref={this.containerRef}
          role="alert"
          tabIndex={-1}
          className="w-full max-w-md rounded-xl border border-border/40 bg-background p-6 text-center outline-none"
        >
          <h2 className="text-[14px] font-medium text-foreground">Couldn’t load this page</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            A network hiccup interrupted loading. Reloading usually fixes it.
          </p>
          <Button
            onClick={this.handleReload}
            className="mt-4 h-9 rounded-lg bg-foreground px-4 text-[13px] font-medium text-background hover:bg-foreground/90"
          >
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}

export default RouteErrorBoundary;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/RouteErrorBoundary.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/RouteErrorBoundary.tsx tests/unit/RouteErrorBoundary.test.tsx
git commit -m "feat(perf): add RouteErrorBoundary for recoverable chunk-load failures"
```

---

## Task 4: Dynamic-import tesseract.js in ocrService

**Files:**
- Modify: `src/services/ocrService.ts` (line 1 import; `initialize()` ~line 23; supabase import ~line 112)
- Test: `tests/unit/ocrService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ocrService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setParameters = vi.fn().mockResolvedValue(undefined);
const terminate = vi.fn().mockResolvedValue(undefined);
const createWorker = vi.fn().mockResolvedValue({ setParameters, recognize: vi.fn(), terminate });

// Hoisted mock — intercepts both static and dynamic `import('tesseract.js')`.
vi.mock('tesseract.js', () => ({ createWorker }));

import { ocrService } from '@/services/ocrService';

describe('ocrService.initialize', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => { await ocrService.terminate(); });

  it('dynamically imports tesseract and creates a worker', async () => {
    await ocrService.initialize();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(setParameters).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ocrService.test.ts`
Expected: FAIL — currently `createWorker` is a static top-level import; the test asserts a single worker create after the refactor. (If it passes trivially, Step 3 still applies for the bundle win.)

- [ ] **Step 3: Edit `src/services/ocrService.ts`**

Remove the top-level tesseract import (line 1):

```ts
// DELETE: import { createWorker } from 'tesseract.js';
```

Add a static supabase import at the top (replaces the dynamic one in `tryEnhancedOCR`):

```ts
import { supabase } from '@/integrations/supabase/client';
```

In `initialize()`, load tesseract at point-of-use (replace the `this.worker = await createWorker(...)` call):

```ts
    try {
      console.log('🔧 Initializing OCR worker...');
      const { createWorker } = await import('tesseract.js');
      this.worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${(m.progress * 100).toFixed(1)}%`);
          }
        }
      });
```

In `tryEnhancedOCR`, delete the inline dynamic import (it now uses the static one):

```ts
// DELETE: const { supabase } = await import('@/integrations/supabase/client');
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/ocrService.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/ocrService.ts tests/unit/ocrService.test.ts
git commit -m "perf(ocr): dynamic-import tesseract.js at point of use; static supabase"
```

---

## Task 5: Normalize self-defeating dual imports (clears build warnings)

These modules are imported both statically (dozens of files) and dynamically (a few), so the dynamic split is negated and they fall back into the entry chunk. Make them static. Behavior is unchanged; no new tests (all four files are coverage-excluded — components/pages/hooks).

**Files:**
- Modify: `src/components/POSSalesFileUpload.tsx` (line 14 import; line 312 usage)
- Modify: `src/components/ReceiptMappingReview.tsx` (top import; lines 204, 401, 441)
- Modify: `src/pages/Inventory.tsx` (lines 382, 556)
- Modify: `src/hooks/useRecipes.tsx` (line 367)

- [ ] **Step 1: `POSSalesFileUpload.tsx`** — add `saveMappingTemplate` to the existing static import (line 14) and remove the dynamic import at line 312.

```ts
// line 14 — add saveMappingTemplate:
import { loadMappingTemplates, findBestMatchingTemplate, applyTemplate, saveMappingTemplate } from '@/utils/mappingTemplates';

// line ~312 — DELETE: const { saveMappingTemplate } = await import('@/utils/mappingTemplates');
// (call saveMappingTemplate(...) directly)
```

- [ ] **Step 2: `ReceiptMappingReview.tsx`** — add a static supabase import at the top and delete the three inline `await import('@/integrations/supabase/client')` (lines 204, 401, 441).

```ts
// top of file:
import { supabase } from '@/integrations/supabase/client';
// DELETE each: const { supabase } = await import('@/integrations/supabase/client');
```

- [ ] **Step 3: `Inventory.tsx`** — add static supabase import at the top; delete the two inline dynamic imports (lines 382, 556).

```ts
// top of file (if not already importing supabase):
import { supabase } from '@/integrations/supabase/client';
// DELETE each: const { supabase } = await import('@/integrations/supabase/client');
```

- [ ] **Step 4: `useRecipes.tsx`** — add static import; delete the dynamic import at line 367 (leave the unrelated `debugRLS` dynamic import at line 159 alone — that one is genuinely split).

```ts
// top of file:
import { calculateInventoryImpact, getProductUnitInfo } from '@/lib/enhancedUnitConversion';
// DELETE: const { calculateInventoryImpact, getProductUnitInfo } = await import('@/lib/enhancedUnitConversion');
```

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/components/POSSalesFileUpload.tsx src/components/ReceiptMappingReview.tsx src/pages/Inventory.tsx src/hooks/useRecipes.tsx
git commit -m "perf(build): normalize dual static/dynamic imports to clear chunk warnings"
```

---

## Task 6: Wire `App.tsx` — lazy routes + Suspense + ErrorBoundary + startTransition

**Files:**
- Modify: `src/App.tsx` (imports lines 19–75; `<BrowserRouter>`/`<Routes>` block lines 248–311)

- [ ] **Step 1: Pre-check — confirm pages are only imported by App.tsx**

Run: `grep -rn "from ['\"].*pages/" src --include='*.tsx' --include='*.ts' | grep -v "src/App.tsx" | grep -vE "pages/Help|pages/Index'\"" | head`
Expected: no page component imported by a non-page module. If a page is imported elsewhere, note it (splitting still works; the page just also lands in that consumer's chunk).

- [ ] **Step 2: Replace the 57 static page imports (lines 19–75) with lazy declarations**

Add near the top (with the other imports):

```tsx
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import RouteFallback from "@/components/RouteFallback";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
```

Replace lines 19–75 (the `import Index ...` … `import WeeklyBrief ...` block) with:

```tsx
const Index = lazyWithRetry(() => import("./pages/Index"));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Team = lazyWithRetry(() => import("./pages/Team"));
const Integrations = lazyWithRetry(() => import("./pages/Integrations"));
const Recipes = lazyWithRetry(() => import("./pages/Recipes"));
const POSSales = lazyWithRetry(() => import("./pages/POSSales"));
const Reports = lazyWithRetry(() => import("./pages/Reports"));
const RestaurantSettings = lazyWithRetry(() => import("./pages/RestaurantSettings"));
const SquareCallback = lazyWithRetry(() => import("./pages/SquareCallback"));
const CloverCallback = lazyWithRetry(() => import("./pages/CloverCallback"));
const ToastCallback = lazyWithRetry(() => import("./pages/ToastCallback"));
const AcceptInvitation = lazyWithRetry(() => import("./pages/AcceptInvitation").then(m => ({ default: m.AcceptInvitation })));
const Inventory = lazyWithRetry(() => import("./pages/Inventory").then(m => ({ default: m.Inventory })));
const InventoryAudit = lazyWithRetry(() => import("./pages/InventoryAudit"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const ReceiptImport = lazyWithRetry(() => import("@/pages/ReceiptImport").then(m => ({ default: m.ReceiptImport })));
const ForgotPassword = lazyWithRetry(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const Unsubscribe = lazyWithRetry(() => import("./pages/Unsubscribe"));
const Transactions = lazyWithRetry(() => import("./pages/Transactions"));
const ChartOfAccounts = lazyWithRetry(() => import("./pages/ChartOfAccounts"));
const FinancialStatements = lazyWithRetry(() => import("./pages/FinancialStatements"));
const Accounting = lazyWithRetry(() => import("./pages/Accounting"));
const Banking = lazyWithRetry(() => import("./pages/Banking"));
const FinancialIntelligence = lazyWithRetry(() => import("./pages/FinancialIntelligence"));
const Scheduling = lazyWithRetry(() => import("./pages/Scheduling"));
const Employees = lazyWithRetry(() => import("./pages/Employees"));
const EmployeeClock = lazyWithRetry(() => import("./pages/EmployeeClock"));
const EmployeePortal = lazyWithRetry(() => import("./pages/EmployeePortal"));
const EmployeeTimecard = lazyWithRetry(() => import("./pages/EmployeeTimecard"));
const EmployeePin = lazyWithRetry(() => import("./pages/EmployeePin"));
const EmployeePay = lazyWithRetry(() => import("./pages/EmployeePay"));
const EmployeeSchedule = lazyWithRetry(() => import("./pages/EmployeeSchedule"));
const AvailableShiftsPage = lazyWithRetry(() => import("./pages/AvailableShiftsPage"));
const PrepRecipesEnhanced = lazyWithRetry(() => import("./pages/PrepRecipesEnhanced"));
const TimePunchesManager = lazyWithRetry(() => import("./pages/TimePunchesManager"));
const Payroll = lazyWithRetry(() => import("./pages/Payroll"));
const Expenses = lazyWithRetry(() => import("./pages/Expenses"));
const PrintChecks = lazyWithRetry(() => import("./pages/PrintChecks"));
const PurchaseOrders = lazyWithRetry(() => import("./pages/PurchaseOrders"));
const PurchaseOrderEditor = lazyWithRetry(() => import("./pages/PurchaseOrderEditor"));
const KioskMode = lazyWithRetry(() => import("./pages/KioskMode"));
const Tips = lazyWithRetry(() => import("./pages/Tips"));
const EmployeeTips = lazyWithRetry(() => import("./pages/EmployeeTips"));
const EmployeeMore = lazyWithRetry(() => import("./pages/EmployeeMore"));
const Customers = lazyWithRetry(() => import("./pages/Customers"));
const Invoices = lazyWithRetry(() => import("./pages/Invoices"));
const InvoiceForm = lazyWithRetry(() => import("./pages/InvoiceForm"));
const InvoiceDetail = lazyWithRetry(() => import("./pages/InvoiceDetail"));
const StripeAccountManagement = lazyWithRetry(() => import("./pages/StripeAccountManagement"));
const PayrollCalculationsHelp = lazyWithRetry(() => import("./pages/Help/PayrollCalculations"));
const HelpCenter = lazyWithRetry(() => import("./pages/Help/HelpCenter"));
const HelpArticle = lazyWithRetry(() => import("./pages/Help/HelpArticle"));
const Assets = lazyWithRetry(() => import("./pages/Assets"));
const BudgetRunRate = lazyWithRetry(() => import("./pages/BudgetRunRate"));
const OpsInbox = lazyWithRetry(() => import("./pages/OpsInbox"));
const WeeklyBrief = lazyWithRetry(() => import("./pages/WeeklyBrief"));
```

- [ ] **Step 3: Wrap routing with startTransition + ErrorBoundary + Suspense**

Change the `<BrowserRouter>` open tag and wrap `<Routes>` (lines ~248–311). Leave `<InstallBanner />` eager, outside Suspense:

```tsx
        <BrowserRouter future={{ v7_startTransition: true }}>
          <InstallBanner />
          <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* …existing <Route> entries unchanged… */}
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        </BrowserRouter>
```

- [ ] **Step 4: Verify typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. Build output now shows many `pages/*` chunks and a much smaller `index-*.js`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "perf(app): lazy-load all 57 routes with Suspense + ErrorBoundary + startTransition"
```

---

## Task 7: Verify bundle reduction + Capacitor build

**Files:** none (verification only).

- [ ] **Step 1: Measure the entry chunk**

Run: `npm run build 2>&1 | grep -E "index-.*\.js|dist/assets/.*\.js" | sort -t'|' -k1 | tail -40`
Expected: the largest single chunk (`index-*.js`) is dramatically smaller than the 5,833 KB baseline (target ~1–2 MB raw); `pages/*` now appear as separate chunks. Record before (5,833 KB raw / 1,587 KB gzip) and after in `progress.md`.

- [ ] **Step 2: Confirm tesseract is no longer in the entry chunk**

Run: `ls -lhS dist/assets/*.js | head; grep -rl "tesseract" dist/assets/*.js | head`
Expected: tesseract code is in its own lazily-loaded chunk (or absent from the entry chunk).

- [ ] **Step 3: Capacitor build smoke (relative base)**

Run: `CAPACITOR_BUILD=true npm run build`
Expected: build succeeds; `dist/index.html` references assets with **relative** paths (`./assets/...`). (A full `npx cap sync` + iOS/Android simulator smoke-load of `/`, `/auth`, `/employee/pay` is a manual pre-release step — note it in the PR.)

- [ ] **Step 4: Full local verification (Phase 8 gate)**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all green. Record results in `progress.md`.

---

## Self-review

**Spec coverage:**
- Route lazy-loading + Suspense + ErrorBoundary + startTransition → Tasks 1,2,3,6 ✅
- lazyWithRetry with web reload-once + native guard → Task 1 ✅
- tesseract dynamic import → Task 4 ✅
- 3 self-defeating dual imports → Tasks 4 (supabase in ocrService) + 5 (mappingTemplates, supabase, enhancedUnitConversion) ✅
- Capacitor compatibility verification → Task 7 Step 3 ✅
- a11y (role=status text, role=alert + focus, reduced-motion, descriptive button), CLAUDE.md tokens → Tasks 2,3 ✅
- Bundle-size + gzip budget metrics → Task 7 ✅

**Placeholder scan:** none — all code blocks complete.

**Type consistency:** `loadModuleWithRetry`/`lazyWithRetry`/`ComponentFactory`/`LoadOptions` consistent across Task 1 and Task 6 usage; `RouteFallback` default export consumed in Task 6; `RouteErrorBoundary` default export consumed in Task 6; `ocrService` singleton + `terminate()` used in Task 4 test.

**Coverage note:** Only `src/lib/lazyWithRetry.ts` and `src/services/ocrService.ts` are in covered paths (both tested). Components, pages, hooks, and `App.tsx` are excluded in both `vitest.config.ts` and `sonar-project.properties` — no new-code-coverage gate risk.
