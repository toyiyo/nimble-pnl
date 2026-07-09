/**
 * Permission Definitions
 *
 * SINGLE SOURCE OF TRUTH for role-to-capability mapping.
 * When adding new roles or capabilities, only modify this file.
 *
 * The SQL function `user_has_capability()` in the database must
 * stay in sync with these definitions.
 */

import { Role, Capability, RoleMetadata, CollaboratorPreset } from './types';

/**
 * Role -> Capability mapping.
 * Defines what each role can do in the system.
 */
export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  // === Internal Roles (full team members) ===

  owner: [
    // Owners have all capabilities
    'view:dashboard',
    'view:ai_assistant',
    'view:transactions',
    'edit:transactions',
    'view:banking',
    'edit:banking',
    'view:expenses',
    'edit:expenses',
    'view:financial_statements',
    'view:chart_of_accounts',
    'edit:chart_of_accounts',
    'view:invoices',
    'edit:invoices',
    'view:customers',
    'edit:customers',
    'view:financial_intelligence',
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'edit:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:reports',
    'view:pending_outflows',
    'edit:pending_outflows',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:pos_sales',
    'view:scheduling',
    'edit:scheduling',
    'view:payroll',
    'edit:payroll',
    'view:tips',
    'edit:tips',
    'view:time_punches',
    'edit:time_punches',
    'view:team',
    'manage:team',
    'view:employees',
    'manage:employees',
    'view:settings',
    'edit:settings',
    'view:integrations',
    'manage:integrations',
    'view:collaborators',
    'manage:collaborators',
  ],

  manager: [
    // Managers have most capabilities except some admin settings
    'view:dashboard',
    'view:ai_assistant',
    'view:transactions',
    'edit:transactions',
    'view:banking',
    'edit:banking',
    'view:expenses',
    'edit:expenses',
    'view:financial_statements',
    'view:chart_of_accounts',
    'view:invoices',
    'edit:invoices',
    'view:customers',
    'edit:customers',
    'view:financial_intelligence',
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'edit:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:reports',
    'view:pending_outflows',
    'edit:pending_outflows',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:pos_sales',
    'view:scheduling',
    'edit:scheduling',
    'view:payroll',
    'edit:payroll',
    'view:tips',
    'edit:tips',
    'view:time_punches',
    'edit:time_punches',
    'view:team',
    'manage:team',
    'view:employees',
    'manage:employees',
    'view:settings',
    'view:integrations',
    'view:collaborators',
    'manage:collaborators',
  ],

  operations_manager: [
    // All operations except accounting (bookkeeping) and admin.
    'view:dashboard',
    'view:ai_assistant',
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'edit:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:reports',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:pos_sales',
    'view:scheduling',
    'edit:scheduling',
    'view:payroll',
    'edit:payroll',
    'view:tips',
    'edit:tips',
    'view:time_punches',
    'edit:time_punches',
    'view:team',
    'manage:team',
    'view:employees',
    'manage:employees',
    'view:settings',
  ],

  chef: [
    // Chef role (internal) - recipes, inventory, and limited operations
    'view:dashboard',
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:reports',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:pos_sales',
    'view:scheduling',
    'view:settings',
  ],

  staff: [
    // Staff only see employee-facing features (handled specially via routes)
    'view:settings',
  ],

  kiosk: [
    // Kiosk only has time clock access (handled specially)
  ],

  // === Collaborator Roles (external specialists, isolated) ===

  collaborator_accountant: [
    // Full financial access including payroll visibility
    'view:transactions',
    'edit:transactions',
    'view:banking',
    'edit:banking',
    'view:expenses',
    'edit:expenses',
    'view:financial_statements',
    'view:chart_of_accounts',
    'edit:chart_of_accounts',
    'view:invoices',
    'edit:invoices',
    'view:customers',
    'edit:customers',
    'view:financial_intelligence',
    'view:pending_outflows',
    'edit:pending_outflows',
    'view:payroll', // Read-only payroll for bookkeeping
    'view:employees', // See employee names for payroll context
    'view:settings',
  ],

  collaborator_inventory: [
    // Inventory management without cost visibility
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'edit:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:settings',
  ],

  collaborator_chef: [
    // Recipe development without cost/margin visibility
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:inventory', // View-only for recipe ingredient context
    'view:settings',
  ],

  collaborator_operations_manager: [
    // Mirrors internal operations_manager minus team/manage-employees/edit-payroll.
    // Full operational breadth (inventory + recipe ops + view payroll + AI assistant).
    'view:dashboard',
    'view:ai_assistant',
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'edit:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:reports',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:pos_sales',
    'view:scheduling',
    'edit:scheduling',
    'view:time_punches',
    'edit:time_punches',
    'view:tips',
    'edit:tips',
    'view:payroll', // Read-only payroll for labor context
    'view:employees', // Read-only, required to assign shifts
    'view:settings',
  ],
} as const;

/**
 * Role metadata for UI rendering
 */
export const ROLE_METADATA: Record<Role, RoleMetadata> = {
  owner: {
    role: 'owner',
    label: 'Owner',
    description: 'Full access to all features',
    category: 'internal',
    landingPath: '/',
    color: 'default',
  },
  manager: {
    role: 'manager',
    label: 'Manager',
    description: 'Manage operations and team',
    category: 'internal',
    landingPath: '/',
    color: 'secondary',
  },
  operations_manager: {
    role: 'operations_manager',
    label: 'Operations Manager',
    description: 'Run operations, scheduling, and staffing (no accounting or admin)',
    category: 'internal',
    landingPath: '/',
    color: 'secondary',
  },
  chef: {
    role: 'chef',
    label: 'Chef',
    description: 'Manage recipes and inventory',
    category: 'internal',
    landingPath: '/',
    color: 'outline',
  },
  staff: {
    role: 'staff',
    label: 'Staff',
    description: 'Employee self-service',
    category: 'internal',
    landingPath: '/employee/clock',
    color: 'outline',
  },
  kiosk: {
    role: 'kiosk',
    label: 'Kiosk',
    description: 'Time clock only',
    category: 'internal',
    landingPath: '/kiosk',
    color: 'outline',
  },
  collaborator_accountant: {
    role: 'collaborator_accountant',
    label: 'Accountant',
    description: 'Financial data access for bookkeeping',
    category: 'collaborator',
    landingPath: '/transactions',
    color: 'outline',
  },
  collaborator_inventory: {
    role: 'collaborator_inventory',
    label: 'Inventory Helper',
    description: 'Inventory and purchasing access',
    category: 'collaborator',
    landingPath: '/inventory',
    color: 'outline',
  },
  collaborator_chef: {
    role: 'collaborator_chef',
    label: 'Recipe Consultant',
    description: 'Recipe development access',
    category: 'collaborator',
    landingPath: '/recipes',
    color: 'outline',
  },
  collaborator_operations_manager: {
    role: 'collaborator_operations_manager',
    // Distinct from the internal 'operations_manager' (also labeled "Operations
    // Manager") so the two never collide in the invite dropdown or on badges.
    // The Collaborators-tab preset CARD title stays "Operations Manager" (see
    // COLLABORATOR_PRESETS below).
    label: 'Operations Manager (Collaborator)',
    description: 'Run scheduling, labor, tips, and inventory operations',
    category: 'collaborator',
    landingPath: '/scheduling',
    color: 'outline',
  },
};

/**
 * Collaborator presets for the invite flow
 */
export const COLLABORATOR_PRESETS: CollaboratorPreset[] = [
  {
    role: 'collaborator_accountant',
    title: 'Accountant',
    description: 'Can view financial reports and help with bookkeeping',
    features: [
      'View and categorize bank transactions',
      'Manage chart of accounts and journal entries',
      'Generate financial statements',
      'Create and manage invoices',
      'View payroll for bookkeeping context',
      'Export reports',
    ],
  },
  {
    role: 'collaborator_inventory',
    title: 'Inventory Helper',
    description: 'Can count, scan, and manage inventory',
    features: [
      'View and adjust inventory levels',
      'Conduct inventory audits',
      'Create purchase orders',
      'Import vendor receipts',
      'Leave variance notes',
    ],
  },
  {
    role: 'collaborator_chef',
    title: 'Chef',
    description: 'Can create and edit recipes',
    features: [
      'Create and edit recipes',
      'Manage prep recipes',
      'Manage production batches',
      'View inventory for ingredient context',
    ],
  },
  {
    role: 'collaborator_operations_manager',
    title: 'Operations Manager',
    description: 'Can run scheduling, labor, tips, and inventory operations',
    features: [
      'Build and edit the schedule',
      'Manage time punches and tips',
      'View payroll for labor context',
      'Manage inventory, purchase orders, and recipes',
    ],
  },
];

/**
 * Check if a role is a collaborator role
 */
export function isCollaboratorRole(role: Role): boolean {
  return role.startsWith('collaborator_');
}

/**
 * Get all collaborator roles
 */
export function getCollaboratorRoles(): Role[] {
  return (Object.keys(ROLE_METADATA) as Role[]).filter(
    (role) => ROLE_METADATA[role].category === 'collaborator'
  );
}

/**
 * Get all internal team roles
 */
export function getInternalRoles(): Role[] {
  return (Object.keys(ROLE_METADATA) as Role[]).filter(
    (role) => ROLE_METADATA[role].category === 'internal'
  );
}

/**
 * Get landing path for a role
 */
export function getLandingPath(role: Role): string {
  return ROLE_METADATA[role]?.landingPath ?? '/';
}
