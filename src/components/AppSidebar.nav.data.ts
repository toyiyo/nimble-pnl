/**
 * Sidebar navigation data — the app's menu, as data.
 *
 * Deliberately a leaf: imports nothing from `@/lib/permissions`. `areas.ts`
 * derives AREA_DEFINITIONS from `navigationGroups` while `AppSidebar.nav.ts`
 * imports `allowedPathsForAreas` from `routeAreas.ts` (which imports
 * `areas.ts`). Keeping the data here is what stops that from being an import
 * cycle — and a cycle with module-level const initialization on both ends is
 * a temporal-dead-zone crash at import time, not a lint warning.
 *
 * Adding a page here without a matching entry in PAGE_AREAS
 * (src/lib/permissions/areas.ts) fails tests/unit/areas.test.ts.
 */
import {
  Home,
  Plug,
  ShoppingCart,
  ChefHat,
  Package,
  ClipboardCheck,
  FileText,
  Users,
  Settings,
  Wallet,
  Receipt,
  CalendarCheck,
  TrendingUp,
  ClipboardList,
  DollarSign,
  ShoppingBag,
  Coins,
  CreditCard,
  Utensils,
  Building2,
  Target,
  Printer,
  Inbox,
  Newspaper,
  LifeBuoy,
  Banknote,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Full navigation structure (owner / manager / chef default)
export const navigationGroups: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { path: '/', label: 'Dashboard', icon: Home },
      { path: '/integrations', label: 'Integrations', icon: Plug },
      { path: '/pos-sales', label: 'POS Sales', icon: ShoppingCart },
      { path: '/ops-inbox', label: 'Ops Inbox', icon: Inbox },
      { path: '/reviews', label: 'Reviews', icon: Star },
      { path: '/weekly-brief', label: 'Weekly Brief', icon: Newspaper },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/scheduling', label: 'Scheduling', icon: CalendarCheck },
      { path: '/time-punches', label: 'Time Clock', icon: ClipboardList },
      { path: '/tips', label: 'Tip Pooling', icon: Coins },
      { path: '/payroll', label: 'Payroll', icon: Wallet },
      { path: '/labor', label: 'Labor', icon: Banknote },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/prep-recipes', label: 'Prep Recipes', icon: Utensils },
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { path: '/budget', label: 'Budget & Run Rate', icon: Target },
      { path: '/customers', label: 'Customers', icon: Users },
      { path: '/invoices', label: 'Invoices', icon: FileText },
      { path: '/stripe-account', label: 'Financial Account', icon: CreditCard },
      { path: '/banking', label: 'Banks', icon: Wallet },
      { path: '/expenses', label: 'Expenses', icon: DollarSign },
      { path: '/print-checks', label: 'Print Checks', icon: Printer },
      { path: '/assets', label: 'Assets & Equipment', icon: Building2 },
      { path: '/financial-intelligence', label: 'Financial Intelligence', icon: TrendingUp },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/chart-of-accounts', label: 'Chart of Accounts', icon: FileText },
      { path: '/financial-statements', label: 'Statements', icon: FileText },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/employees', label: 'Employees', icon: Users },
      { path: '/team', label: 'Team', icon: Users },
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/help', label: 'Help Center', icon: LifeBuoy },
    ],
  },
];

// Nav items that exist for a collaborator but have no row in
// navigationGroups: an owner reaches Receipt Import from inside Inventory, so
// it was never a top-level entry for them. collaboratorInventoryNav declares
// it, and a custom inventory role is routed to it — without this the derived
// sidebar would omit a page the role can open.
export const SUPPLEMENTAL_NAV_ITEMS: Record<string, NavItem[]> = {
  Inventory: [{ path: '/receipt-import', label: 'Receipt Import', icon: Receipt }],
};
