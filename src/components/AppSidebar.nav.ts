/**
 * Navigation data and role-based filtering for AppSidebar.
 *
 * Extracted into a separate module so it can be unit-tested without
 * rendering the full sidebar (which depends on React context).
 */
import {
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
  Clock,
  DollarSign,
  ShoppingBag,
  CalendarDays,
  Utensils,
  Building2,
  Printer,
  LifeBuoy,
} from 'lucide-react';
import { allowedPathsForAreas } from '@/lib/permissions/routeAreas';
import type { AreaKey, AreaLevel } from '@/lib/permissions/areas';
import type { NavItem, NavGroup } from '@/components/AppSidebar.nav.data';
import { navigationGroups, SUPPLEMENTAL_NAV_ITEMS } from '@/components/AppSidebar.nav.data';

// Re-exported so existing importers (AppSidebar.tsx, permissions/preview.ts,
// tests) don't need to change when this data moved to AppSidebar.nav.data.ts.
export type { NavItem, NavGroup } from '@/components/AppSidebar.nav.data';
export { navigationGroups, SUPPLEMENTAL_NAV_ITEMS };

// Navigation groups for collaborator roles
export const collaboratorAccountantNav: NavGroup[] = [
  {
    label: 'Financial',
    items: [
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/banking', label: 'Banks', icon: Wallet },
      { path: '/expenses', label: 'Expenses', icon: DollarSign },
      { path: '/print-checks', label: 'Print Checks', icon: Printer },
      { path: '/assets', label: 'Assets', icon: Building2 },
      { path: '/invoices', label: 'Invoices', icon: FileText },
      { path: '/customers', label: 'Customers', icon: Users },
      { path: '/chart-of-accounts', label: 'Chart of Accounts', icon: FileText },
      { path: '/financial-statements', label: 'Statements', icon: FileText },
      { path: '/financial-intelligence', label: 'Intelligence', icon: TrendingUp },
    ],
  },
  {
    label: 'Payroll',
    items: [
      { path: '/payroll', label: 'Payroll', icon: Wallet },
      { path: '/employees', label: 'Employees', icon: Users },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/help', label: 'Help Center', icon: LifeBuoy },
    ],
  },
];

export const collaboratorInventoryNav: NavGroup[] = [
  {
    label: 'Inventory',
    items: [
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag },
      { path: '/receipt-import', label: 'Receipt Import', icon: Receipt },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/help', label: 'Help Center', icon: LifeBuoy },
    ],
  },
];

export const collaboratorChefNav: NavGroup[] = [
  {
    label: 'Recipes',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/prep-recipes', label: 'Prep Recipes', icon: Utensils },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/inventory', label: 'Inventory', icon: Package },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/help', label: 'Help Center', icon: LifeBuoy },
    ],
  },
];

export const staffNav: NavGroup[] = [
  {
    label: 'Employee',
    items: [
      { path: '/employee/clock', label: 'Time Clock', icon: Clock },
      { path: '/employee/timecard', label: 'My Timecard', icon: FileText },
      { path: '/employee/schedule', label: 'My Schedule', icon: CalendarDays },
      { path: '/employee/pay', label: 'My Pay', icon: Wallet },
      { path: '/employee/portal', label: 'My Requests', icon: CalendarCheck },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/help', label: 'Help Center', icon: LifeBuoy },
    ],
  },
];

// Operations Manager: full internal nav minus Accounting group and Integrations.
export const operationsManagerNav: NavGroup[] = navigationGroups
  .filter((group) => group.label !== 'Accounting')
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => item.path !== '/integrations'),
  }));

// Collaborator Operations Manager: bespoke, scoped nav for the external ops
// collaborator role. DERIVED from navigationGroups (same pattern as
// operationsManagerNav) rather than re-declaring item objects — keeps a single
// source of truth for paths/labels/icons. Do NOT reuse operationsManagerNav:
// that still includes the Admin group's /team, which this role must never see
// (fail-open risk flagged in Phase 2.5 design review).
//   - Accounting group: dropped entirely.
//   - Main: trimmed to POS Sales only (no Dashboard, Integrations, Ops Inbox).
//   - Admin: relabelled "Settings", trimmed to Settings + Help — /team and
//     /employees are intentionally excluded (/employees stays in the route
//     allow-list for scheduling context, but is not surfaced in the sidebar).
//   - Operations: kept as-is.
//   - Inventory: kept, minus /reports — the Reports page is P&L (defaults to
//     P&L Trends), which this accounting-excluded role must not reach
//     (Codex P1, PR #596).
export const collaboratorOperationsManagerNav: NavGroup[] = navigationGroups
  .filter((group) => group.label !== 'Accounting')
  .map((group) => {
    if (group.label === 'Main') {
      return { ...group, items: group.items.filter((item) => item.path === '/pos-sales') };
    }
    if (group.label === 'Inventory') {
      return { ...group, items: group.items.filter((item) => item.path !== '/reports') };
    }
    if (group.label === 'Admin') {
      return {
        label: 'Settings',
        items: group.items.filter((item) => item.path === '/settings' || item.path === '/help'),
      };
    }
    return group;
  });

// Every collaborator nav renames the Admin group, since a collaborator sees
// only its Settings/Help tail.
const DERIVED_GROUP_LABELS: Record<string, string> = {
  Admin: 'Settings',
};

// Route-reachable but never a sidebar entry for an external role. /employees
// is scheduling and payroll *context* — collaboratorOperationsManagerNav and
// collaboratorAccountantNav differ on it precisely because the allow-list and
// the sidebar are two separate artifacts, which an areas -> nav filter alone
// cannot express.
const NAV_HIDDEN_PATHS: readonly string[] = ['/employees'];

/**
 * Derives a sidebar from a role's area grants, for roles that have no
 * hand-written nav array — i.e. custom collaborator roles.
 *
 * Filtered against `allowedPathsForAreas`, so the sidebar can never offer a
 * page StaffRoleChecker would bounce the user off.
 */
export function getNavigationForAreas(
  grants: Partial<Record<AreaKey, AreaLevel>>
): NavGroup[] {
  const allowed = new Set(allowedPathsForAreas(grants));
  const hidden = new Set(NAV_HIDDEN_PATHS);

  return navigationGroups
    .map((group) => {
      const items = [...group.items, ...(SUPPLEMENTAL_NAV_ITEMS[group.label] ?? [])].filter(
        (item) => allowed.has(item.path) && !hidden.has(item.path)
      );
      return { label: DERIVED_GROUP_LABELS[group.label] ?? group.label, items };
    })
    .filter((group) => group.items.length > 0);
}

// Get navigation groups based on role. Optional `viewMode`: when 'work',
// the nav collapses to staffNav regardless of role (personal "My Work" lens).
// Omitted/'admin' preserves existing role-based behavior. Optional `grants`:
// the role's area levels, used only by roles with no hand-written nav array.
export function getNavigationForRole(
  role: string | undefined,
  viewMode?: 'admin' | 'work',
  grants?: Partial<Record<AreaKey, AreaLevel>>
): NavGroup[] {
  // Work mode wins over an undefined role: during the remount-timing window
  // right after enterWorkMode()'s navigate(), role can be briefly undefined
  // before RestaurantProvider re-hydrates. Checking this before the `!role`
  // early-return prevents the sidebar from flashing empty in that window.
  if (viewMode === 'work') {
    return staffNav;
  }

  if (!role) return [];

  switch (role) {
    case 'kiosk':
      return []; // Kiosk users see no sidebar
    case 'staff':
      return staffNav;
    case 'collaborator_accountant':
      return collaboratorAccountantNav;
    case 'collaborator_inventory':
      return collaboratorInventoryNav;
    case 'collaborator_chef':
      return collaboratorChefNav;
    case 'collaborator_operations_manager':
      return collaboratorOperationsManagerNav;
    case 'operations_manager':
      return operationsManagerNav;
    default:
      // A `collaborator_*` string that matched no case above is a custom
      // role ('collaborator_custom'): derive its sidebar from its areas, and
      // fail closed to an empty sidebar if those grants haven't arrived —
      // never fall through to the full internal nav below.
      if (role.startsWith('collaborator_')) {
        return grants ? getNavigationForAreas(grants) : [];
      }
      // owner, manager, chef get full navigation
      return navigationGroups;
  }
}
