/**
 * Types of the shared labor engine.
 *
 * The engine runs in the browser (through the `src/` shims) and in the Deno
 * edge functions. It must not import the `src/` UI types.
 *
 * - Input types (`LaborEmployee`, `LaborShift`, `LaborTimePunch`) name only
 *   the fields that the engine reads. The full UI types in `src/types/` are
 *   structural supersets, so `tsc` checks each call.
 * - The compensation types and the output types that the UI uses live here.
 *   `src/types/scheduling.ts` re-exports them.
 */

// ============================================================================
// Compensation types (re-exported by src/types/scheduling.ts)
// ============================================================================

export type CompensationType = 'hourly' | 'salary' | 'contractor' | 'daily_rate';
export type PayPeriodType = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
export type ContractorPaymentInterval = 'weekly' | 'bi-weekly' | 'monthly' | 'per-job';

/**
 * Canonical employee status type.
 * Mirrors the DB constraint `employees_status_active_sync`:
 *   active → is_active = true
 *   inactive | terminated → is_active = false
 */
export type EmployeeStatus = 'active' | 'inactive' | 'terminated';

export interface CompensationHistoryEntry {
  id: string;
  employee_id: string;
  restaurant_id: string;
  compensation_type: CompensationType;
  amount_cents: number;
  pay_period_type?: PayPeriodType | null;
  effective_date: string; // YYYY-MM-DD
  created_at: string;
}

// ============================================================================
// Engine input types
// ============================================================================

/**
 * The `employees` fields the engine reads. `Employee` in
 * `src/types/scheduling.ts` is a superset. Each field keeps the optionality
 * of `Employee`, so an `Employee` is always a `LaborEmployee`.
 */
export interface LaborEmployee {
  id: string;
  restaurant_id: string;
  name: string;
  position: string;
  area?: string;
  status: EmployeeStatus;
  hire_date?: string;
  termination_date?: string;
  is_active: boolean;
  deactivated_at?: string;
  last_active_date?: string;

  compensation_type: CompensationType;
  hourly_rate: number; // In cents
  salary_amount?: number; // In cents (per-period amount)
  pay_period_type?: PayPeriodType;
  allocate_daily?: boolean;
  contractor_payment_amount?: number; // In cents (per-interval payment)
  contractor_payment_interval?: ContractorPaymentInterval;
  daily_rate_amount?: number; // In cents
  daily_rate_reference_weekly?: number; // In cents
  daily_rate_reference_days?: number;
  requires_time_punch?: boolean;
  is_exempt?: boolean;

  compensation_history?: CompensationHistoryEntry[];
}

/**
 * The keys of `LaborEmployee` as a runtime list. A test cannot read interface
 * keys at runtime, so tests check an employee select against this list. The
 * `satisfies` clause rejects a key that `LaborEmployee` does not have.
 */
export const LABOR_EMPLOYEE_KEYS = [
  'id',
  'restaurant_id',
  'name',
  'position',
  'area',
  'status',
  'hire_date',
  'termination_date',
  'is_active',
  'deactivated_at',
  'last_active_date',
  'compensation_type',
  'hourly_rate',
  'salary_amount',
  'pay_period_type',
  'allocate_daily',
  'contractor_payment_amount',
  'contractor_payment_interval',
  'daily_rate_amount',
  'daily_rate_reference_weekly',
  'daily_rate_reference_days',
  'requires_time_punch',
  'is_exempt',
  'compensation_history',
] as const satisfies readonly (keyof LaborEmployee)[];

/** The `time_punches` fields the engine reads. `TimePunch` is a superset. */
export interface LaborTimePunch {
  id: string;
  restaurant_id: string;
  employee_id: string;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: string;
  created_at: string;
  updated_at: string;
}

/** The `shifts` fields the engine reads. `Shift` is a superset. */
export interface LaborShift {
  employee_id: string;
  start_time: string;
  end_time: string;
  /** In minutes. It can be null at runtime (the column has no NOT NULL). */
  break_duration: number;
}

// ============================================================================
// Output types (re-exported by src/types/scheduling.ts)
// ============================================================================

// Daily labor allocation for salaried/contractor employees
export interface DailyLaborAllocation {
  id: string;
  restaurant_id: string;
  employee_id: string;
  date: string; // DATE format (YYYY-MM-DD)
  compensation_type: CompensationType;
  allocated_amount: number; // In cents (daily portion of salary/contractor payment)
  calculation_notes?: string; // e.g., "Weekly salary $1000 / 7 days = $142.86/day"
  source_pay_period_start?: string; // Start of the pay period this allocation is from
  source_pay_period_end?: string; // End of the pay period
  created_at: string;
  updated_at: string;
  employee?: LaborEmployee; // Joined data
}

// Helper type for payroll calculations
export interface CompensationSummary {
  compensation_type: CompensationType;
  total_amount: number; // In cents
  hours_worked?: number; // For hourly employees
  days_worked?: number; // For salary/contractor with daily allocation
  effective_hourly_rate?: number; // Calculated for comparison
}

// Labor cost breakdown by compensation type
export interface LaborCostBreakdown {
  hourly_wages: number; // In cents
  salary_allocations: number; // In cents
  contractor_payments: number; // In cents
  total: number; // In cents
}

// ============================================================================
// Query client
// ============================================================================

/**
 * The smallest client type that the shared engine takes. The typed browser
 * client and the Deno supabase-js client both fit it, and the engine imports
 * no `@supabase/supabase-js` type.
 *
 * A type that describes the full query chain fails on the typed browser
 * client with TS2589 (excessive type depth). So `from()` returns `unknown`,
 * and each reader casts it to its own chain type in one type-only helper.
 * See `tests/unit/types/laborQueryClient.test.ts`.
 */
export interface LaborQueryClient {
  from(table: string): unknown;
}
