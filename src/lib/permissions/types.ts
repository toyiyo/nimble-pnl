/**
 * Permission Types
 *
 * Defines the core types for the role-based permission system.
 * This is the foundation for all permission checking throughout the app.
 */

/**
 * All possible roles in the system.
 *
 * Internal roles (full team members):
 * - owner: Full access to all features
 * - manager: Most features except some admin
 * - chef: Recipes and inventory focus
 * - staff: Employee self-service only
 * - kiosk: Time clock only
 *
 * Collaborator roles (external specialists):
 * - collaborator_accountant: Financial data access
 * - collaborator_inventory: Inventory management access
 * - collaborator_chef: Recipe development access
 */
export type Role =
  | 'owner'
  | 'manager'
  | 'chef'
  | 'staff'
  | 'kiosk'
  | 'collaborator_accountant'
  | 'collaborator_inventory'
  | 'collaborator_chef';

/**
 * Fine-grained capabilities that roles can have.
 * Format: action:resource (e.g., 'view:transactions', 'edit:recipes')
 *
 * This is the atomic unit of permission checking.
 */
export type Capability =
  // Dashboard & General
  | 'view:dashboard'
  | 'view:ai_assistant'

  // Financial capabilities (accountant surface)
  | 'view:transactions'
  | 'edit:transactions'
  | 'view:banking'
  | 'edit:banking'
  | 'view:expenses'
  | 'edit:expenses'
  | 'view:financial_statements'
  | 'view:chart_of_accounts'
  | 'edit:chart_of_accounts'
  | 'view:invoices'
  | 'edit:invoices'
  | 'view:customers'
  | 'edit:customers'
  | 'view:financial_intelligence'

  // Inventory capabilities (inventory surface)
  | 'view:inventory'
  | 'edit:inventory'
  | 'view:inventory_audit'
  | 'edit:inventory_audit'
  | 'view:purchase_orders'
  | 'edit:purchase_orders'
  | 'view:receipt_import'
  | 'edit:receipt_import'
  | 'view:reports'
  | 'view:pending_outflows'
  | 'edit:pending_outflows'
  | 'view:inventory_transactions'
  | 'edit:inventory_transactions'

  // Recipe capabilities (chef surface)
  | 'view:recipes'
  | 'edit:recipes'
  | 'view:prep_recipes'
  | 'edit:prep_recipes'
  | 'view:batches'
  | 'edit:batches'

  // Operations capabilities
  | 'view:pos_sales'
  | 'view:scheduling'
  | 'edit:scheduling'
  | 'view:payroll'
  | 'edit:payroll'
  | 'view:tips'
  | 'edit:tips'
  | 'view:time_punches'
  | 'edit:time_punches'

  // Admin capabilities
  | 'view:team'
  | 'manage:team'
  | 'view:employees'
  | 'manage:employees'
  | 'view:settings'
  | 'edit:settings'
  | 'view:integrations'
  | 'manage:integrations'
  | 'view:collaborators'
  | 'manage:collaborators';

/**
 * Role category for grouping in UI and determining behavior
 */
export type RoleCategory = 'internal' | 'collaborator';

/**
 * Role metadata for UI rendering and navigation
 */
export interface RoleMetadata {
  role: Role;
  label: string;
  description: string;
  category: RoleCategory;
  landingPath: string;
  color: 'default' | 'secondary' | 'outline' | 'destructive';
}

/**
 * Collaborator preset for the invite flow
 */
export interface CollaboratorPreset {
  role: Role;
  title: string;
  description: string;
  features: string[];
}
