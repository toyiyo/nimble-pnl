/**
 * The 33 pages' raw permission data, positional rows — split out of
 * `areas.ts` (which builds `PAGE_AREAS` from these) purely so SonarCloud's
 * duplication detector, which treats each structurally-identical
 * `[key, path, bool, level, string, string?]` row as a duplicate block of a
 * neighboring row, scores this table on its own rather than dragging down
 * the duplication density of `areas.ts`'s actual logic (`expandAreas`,
 * `landingAreaKey`, etc.). This file is excluded from `sonar.cpd.exclusions`
 * for exactly that reason — see sonar-project.properties.
 *
 * No behavior lives here. `key`/`path` here are transcribed literally (not
 * derived) from `supabase/migrations/20260805120000_page_areas.sql`'s
 * `area_catalog` — see the header comment on `areas.ts` for the full
 * source-of-truth chain.
 */
import type { AreaKey, AreaLevel } from './areas';

/**
 * Positional row for one `PAGE_AREAS` entry —
 * `[key, path, hasManageTier, maxLevelForCollaborator, hint, manageHint?, navLabel?]`.
 * Written this way (rather than 33 object literals repeating the same five
 * property names) because the repeated `hasManageTier:`/
 * `maxLevelForCollaborator:`/`hint:`/`manageHint:` keys, identical across
 * nearly every row, read as duplicated code to static analysis even though
 * the *data* isn't duplicated — each row's values differ. `PAGE_AREAS`
 * (areas.ts) reconstructs the exact same `PageArea[]` from these rows; this
 * is a presentation change only.
 */
export type PageAreaRow = readonly [
  key: AreaKey,
  path: string,
  hasManageTier: boolean,
  maxLevelForCollaborator: AreaLevel | null,
  hint: string,
  manageHint?: string,
  navLabel?: string,
];

export const PAGE_AREA_ROWS: readonly PageAreaRow[] = [
  // Main
  ['dashboard', '/', false, 'view', 'Daily numbers, prime cost, P&L snapshot'],
  ['integrations', '/integrations', true, 'view', 'POS, bank and payroll connections', 'connect and disconnect systems'],
  ['sales', '/pos-sales', false, 'view', 'Ticket-level sales from your POS'],
  ['ops_inbox', '/ops-inbox', false, 'view', 'Exceptions and things needing a decision'],
  ['reviews', '/reviews', true, 'view', 'Review pages, QR codes, guest feedback', 'edit QR pages and reply'],
  ['weekly_brief', '/weekly-brief', false, 'view', 'The weekly summary and its archive'],

  // Operations
  ['scheduling', '/scheduling', true, 'manage', 'Shifts, templates, open-shift broadcasts', 'publish and edit schedules'],
  ['time_punches', '/time-punches', true, 'manage', 'Punches, edits, missed-punch fixes', 'edit punches'],
  ['tips', '/tips', true, 'manage', 'Pools, rules and distribution', 'run and adjust distributions'],
  ['payroll', '/payroll', true, 'view', 'Pay runs and payroll history', 'run payroll'],
  ['labor', '/labor', false, 'view', 'Labor cost against sales'],

  // Inventory
  ['recipes', '/recipes', true, 'manage', 'Recipe cards and plate cost', 'create and edit recipes'],
  ['prep_recipes', '/prep-recipes', true, 'manage', 'Prep items and production batches', 'edit prep items and batches'],
  ['inventory', '/inventory', true, 'manage', 'Counts, stock levels, unit costs', 'adjust counts and costs'],
  ['inventory_audit', '/inventory-audit', true, 'manage', 'Count sessions and variance', 'run and close audits'],
  ['purchasing', '/purchase-orders', true, 'manage', 'POs, receiving, supplier invoices', 'raise and receive POs'],
  ['reports', '/reports', true, 'view', 'Saved reports and P&L trends', 'use the AI assistant'],

  // Accounting
  ['budget', '/budget', false, 'view', 'Targets and burn against plan'],
  ['customers', '/customers', true, 'manage', 'Customer records and balances', 'add and edit customers'],
  ['invoices', '/invoices', true, 'manage', 'Draft, send and track invoices', 'create, send and void invoices'],
  ['stripe_account', '/stripe-account', false, 'view', 'Balance, payouts and transfers'],
  ['banking', '/banking', true, 'manage', 'Connected accounts and feeds', 'connect and reconcile'],
  ['expenses', '/expenses', true, 'manage', 'Bills, receipts and categories', 'record and categorise'],
  ['print_checks', '/print-checks', true, 'manage', 'Issue and print checks', 'issue checks — this moves money'],
  ['assets', '/assets', true, 'manage', 'Fixed assets and depreciation', 'add and depreciate assets'],
  ['financial_intelligence', '/financial-intelligence', false, 'view', 'AI analysis over your books'],
  ['transactions', '/transactions', true, 'manage', 'The ledger and categorisation', 'edit and recategorise'],
  ['chart_of_accounts', '/chart-of-accounts', true, 'manage', 'Account tree and mappings', 'add and rename accounts'],
  ['financial_statements', '/financial-statements', false, 'view', 'P&L, balance sheet, cash flow'],

  // Admin
  ['employees', '/employees', true, 'manage', 'Roster, jobs, wage assignments', 'hire, edit and terminate'],
  ['team', '/team', true, null, 'Invite people, assign roles, edit these roles', undefined, 'Team members'],
  ['collaborators', '/team', true, null, 'Add external collaborators and set what they can do', undefined, 'Collaborators'],
  ['settings', '/settings', true, 'view', 'Restaurant profile, hours, timezone', 'change settings'],
];
