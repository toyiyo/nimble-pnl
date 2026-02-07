// Gusto Embedded Payroll Types

// ============================================================================
// Connection & Authentication
// ============================================================================

export interface GustoConnection {
  id: string;
  restaurant_id: string;
  company_uuid: string;
  company_name: string | null;
  scopes: string[];
  token_type: string;
  connected_at: string;
  expires_at: string | null;
  last_refreshed_at: string | null;
  last_synced_at: string | null;
  onboarding_status: GustoOnboardingStatus;
  created_at: string;
  updated_at: string;
}

export type GustoOnboardingStatus = 'pending' | 'in_progress' | 'completed';

export interface GustoOAuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface GustoCompany {
  uuid: string;
  name: string;
  trade_name: string | null;
  ein: string;
  entity_type: string;
  company_status: string;
  is_suspended: boolean;
  locations: GustoLocation[];
}

export interface GustoLocation {
  uuid: string;
  company_uuid: string;
  version: string;
  phone_number: string | null;
  street_1: string;
  street_2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  active: boolean;
}

// ============================================================================
// Employee Types
// ============================================================================

export interface GustoEmployee {
  uuid: string;
  first_name: string;
  middle_initial: string | null;
  last_name: string;
  email: string | null;
  ssn?: string; // Only in responses when explicitly requested
  date_of_birth: string | null;
  company_uuid: string;
  manager_uuid: string | null;
  version: string;
  department: string | null;
  terminated: boolean;
  two_percent_shareholder: boolean;
  onboarding_status: GustoEmployeeOnboardingStatus;
  jobs: GustoJob[];
  home_address?: GustoAddress;
  payment_method: 'Direct Deposit' | 'Check';
  custom_fields?: GustoCustomField[];
}

export type GustoEmployeeOnboardingStatus =
  | 'admin_onboarding_incomplete'
  | 'self_onboarding_pending_invite'
  | 'self_onboarding_invited'
  | 'self_onboarding_in_progress'
  | 'self_onboarding_completed_by_employee'
  | 'onboarding_completed';

export interface GustoJob {
  uuid: string;
  version: string;
  employee_uuid: string;
  location_uuid: string;
  title: string;
  primary: boolean;
  rate: string;
  payment_unit: 'Hour' | 'Year' | 'Paycheck' | 'Month' | 'Week';
  current_compensation_uuid: string;
}

export interface GustoAddress {
  street_1: string;
  street_2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface GustoCustomField {
  id: string;
  company_custom_field_id: string;
  name: string;
  type: string;
  value: string;
}

// ============================================================================
// Contractor Types
// ============================================================================

export interface GustoContractor {
  uuid: string;
  company_uuid: string;
  type: 'Individual' | 'Business';
  first_name: string | null;
  last_name: string | null;
  middle_initial: string | null;
  business_name: string | null;
  ein: string | null;
  email: string | null;
  is_active: boolean;
  version: string;
  address?: GustoAddress;
}

// ============================================================================
// Payroll Types
// ============================================================================

export interface GustoPayroll {
  uuid: string;
  company_uuid: string;
  pay_period: GustoPayPeriod;
  check_date: string;
  payroll_deadline: string;
  processed: boolean;
  payroll_uuid: string;
  version: string;
  totals?: GustoPayrollTotals;
  employee_compensations?: GustoEmployeeCompensation[];
}

export interface GustoPayPeriod {
  start_date: string;
  end_date: string;
  pay_schedule_uuid: string;
}

export interface GustoPayrollTotals {
  company_debit: string;
  net_pay: string;
  tax_debit: string;
  gross_pay: string;
  reimbursements: string;
  employer_taxes: string;
  employee_taxes: string;
  benefits: string;
}

export interface GustoEmployeeCompensation {
  employee_uuid: string;
  gross_pay: string;
  net_pay: string;
  payment_method: string;
  fixed_compensations: GustoFixedCompensation[];
  hourly_compensations: GustoHourlyCompensation[];
  taxes: GustoTax[];
  benefits: GustoBenefit[];
}

export interface GustoFixedCompensation {
  name: string;
  amount: string;
  job_uuid: string;
}

export interface GustoHourlyCompensation {
  name: string;
  hours: string;
  job_uuid: string;
  compensation_multiplier: number;
}

export interface GustoTax {
  name: string;
  amount: string;
  employer: boolean;
}

export interface GustoBenefit {
  name: string;
  employee_deduction: string;
  company_contribution: string;
  imputed: boolean;
}

// ============================================================================
// Time Activity Types (for syncing time punches)
// ============================================================================

export interface GustoTimeActivity {
  uuid?: string;
  employee_uuid: string;
  date: string; // YYYY-MM-DD
  hours: string; // Decimal string, e.g., "8.5"
  activity_type: 'regular' | 'overtime' | 'double_overtime' | 'pto' | 'sick';
  description?: string;
  version?: string;
}

export interface GustoTimeActivityBatch {
  time_activities: GustoTimeActivity[];
}

// ============================================================================
// Flow Types (for embedded UI)
// ============================================================================

// Flow types as expected by Gusto API
// See: https://docs.gusto.com/embedded-payroll/docs/flow-types
export type GustoFlowType =
  | 'company_onboarding'      // Complete company setup
  | 'add_employees'           // Add W-2 employees
  | 'add_contractors'         // Add 1099 contractors
  | 'run_payroll'             // Run payroll (requires onboarded company)
  | 'employee_self_management' // Employee self-onboarding
  | 'add_addresses'           // Add company work locations
  | 'sign_all_forms'          // Sign all pending forms
  | 'federal_tax_setup'       // Federal tax setup
  | 'state_tax_setup';        // State tax setup

export interface GustoFlowResponse {
  url: string;
  expires_at: string;
  flow_type: GustoFlowType;
}

export interface GustoFlowRequest {
  flow_type: GustoFlowType;
  entity_uuid?: string; // Required for employee/contractor onboarding flows
  entity_type?: 'Employee' | 'Contractor' | 'Company';
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface GustoWebhookEvent {
  uuid: string;
  event_type: GustoWebhookEventType;
  resource_type: string;
  resource_uuid: string;
  entity_type: string;
  entity_uuid: string;
  timestamp: number;
  company_uuid: string;
}

export type GustoWebhookEventType =
  // Company events
  | 'company.provisioned'
  | 'company.updated'
  // Employee events
  | 'employee.created'
  | 'employee.updated'
  | 'employee.terminated'
  | 'employee.rehired'
  // Contractor events
  | 'contractor.onboarded'
  | 'contractor.deactivated'
  // Payroll events
  | 'payroll.submitted'
  | 'payroll.processed'
  | 'payroll.paid'
  // Bank account events
  | 'bank_account.created'
  | 'bank_account.updated'
  // Form events
  | 'form.i9_completed'
  | 'form.w4_completed';

export interface GustoWebhookSubscription {
  uuid: string;
  url: string;
  subscription_types: string[];
}

// ============================================================================
// Sync Status Types
// ============================================================================

export type GustoSyncStatus = 'not_synced' | 'pending' | 'synced' | 'error';

export interface EmployeeGustoSyncInfo {
  gusto_employee_uuid: string | null;
  gusto_synced_at: string | null;
  gusto_sync_status: GustoSyncStatus;
  gusto_onboarding_status: GustoEmployeeOnboardingStatus | null;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface GustoApiError {
  error: string;
  error_description?: string;
  errors?: GustoValidationError[];
}

export interface GustoValidationError {
  field: string;
  message: string;
  error_key: string;
}

export interface GustoPaginatedResponse<T> {
  data: T[];
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
}

// ============================================================================
// Local Payroll Run Storage
// ============================================================================

export interface GustoPayrollRun {
  id: string;
  restaurant_id: string;
  gusto_payroll_uuid: string;
  pay_period_start: string;
  pay_period_end: string;
  check_date: string;
  payroll_type: 'regular' | 'off_cycle' | 'termination' | null;
  status: 'unprocessed' | 'processed' | 'pending' | 'approved';
  total_gross_pay: number | null; // In cents
  total_net_pay: number | null; // In cents
  total_employer_taxes: number | null; // In cents
  total_employee_taxes: number | null; // In cents
  employee_count: number | null;
  raw_payload: GustoPayroll | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}
