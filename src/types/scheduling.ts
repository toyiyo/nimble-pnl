// Compensation types for employees
export type CompensationType = 'hourly' | 'salary' | 'contractor';
export type PayPeriodType = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
export type ContractorPaymentInterval = 'weekly' | 'bi-weekly' | 'monthly' | 'per-job';
export type DeactivationReason = 'seasonal' | 'left_company' | 'on_leave' | 'other';

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

export interface Employee {
  id: string;
  restaurant_id: string;
  name: string;
  email?: string;
  phone?: string;
  position: string;
  status: 'active' | 'inactive' | 'terminated';
  hire_date?: string;
  termination_date?: string; // Date when employee was terminated/inactivated
  notes?: string;
  created_at: string;
  updated_at: string;
  user_id?: string; // Link to auth.users for self-service
  
  // Activation tracking (for deactivate/reactivate flow)
  is_active: boolean; // Controls login, PIN, and scheduling access
  deactivation_reason?: DeactivationReason | string; // Why employee was deactivated
  deactivated_at?: string; // Timestamp of deactivation
  deactivated_by?: string; // User ID who deactivated
  reactivated_at?: string; // Timestamp of reactivation
  reactivated_by?: string; // User ID who reactivated
  last_active_date?: string; // Date of last shift or punch (set automatically)
  
  // Compensation fields
  compensation_type: CompensationType; // Determines which fields are relevant
  
  // Hourly employees
  hourly_rate: number; // In cents (used when compensation_type = 'hourly')
  
  // Salaried employees
  salary_amount?: number; // In cents (per-period amount)
  pay_period_type?: PayPeriodType; // How often they're paid
  allocate_daily?: boolean; // Whether to spread salary across days for Daily P&L
  
  // Contractors
  contractor_payment_amount?: number; // In cents (per-interval payment)
  contractor_payment_interval?: ContractorPaymentInterval;
  
  // Time tracking & tips
  requires_time_punch?: boolean; // Must clock in/out (true for hourly, optional for others)
  tip_eligible?: boolean; // Can receive tip pool distributions

  // Compensation history (optional join)
  compensation_history?: CompensationHistoryEntry[];
}

export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekday' | 'custom';
export type RecurrenceEndType = 'never' | 'on' | 'after';

export interface RecurrencePattern {
  type: RecurrenceType;
  interval?: number; // e.g., 1 for every week, 2 for every 2 weeks
  daysOfWeek?: number[]; // 0=Sunday, 6=Saturday (for weekly/custom)
  dayOfMonth?: number; // 1-31 (for monthly)
  weekOfMonth?: number; // 1-5 (for monthly "third Sunday" pattern)
  monthOfYear?: number; // 1-12 (for yearly)
  endType: RecurrenceEndType;
  endDate?: string; // ISO date string (when endType is "on")
  occurrences?: number; // (when endType is "after")
}

export interface Shift {
  id: string;
  restaurant_id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  break_duration: number; // In minutes
  position: string;
  notes?: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  recurrence_pattern?: RecurrencePattern | null;
  recurrence_parent_id?: string | null;
  is_recurring?: boolean;
  published_at?: string | null;
  published_by?: string | null;
  is_published: boolean;
  locked: boolean;
  created_at: string;
  updated_at: string;
  employee?: Employee; // Joined data
}

export interface ShiftTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimeOffRequest {
  id: string;
  restaurant_id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  created_at: string;
  updated_at: string;
  employee?: Employee; // Joined data
}

export interface ScheduleWeek {
  startDate: Date;
  endDate: Date;
  shifts: Shift[];
}

export interface LaborMetrics {
  totalHours: number;
  totalCost: number; // In cents
  employeeCount: number;
  averageHourlyRate: number; // In cents
}

export interface EmployeeAvailability {
  id: string;
  restaurant_id: string;
  employee_id: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  start_time: string; // TIME format (HH:MM:SS)
  end_time: string; // TIME format (HH:MM:SS)
  is_available: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityException {
  id: string;
  restaurant_id: string;
  employee_id: string;
  date: string; // DATE format (YYYY-MM-DD)
  start_time?: string; // TIME format (HH:MM:SS) - null if unavailable all day
  end_time?: string; // TIME format (HH:MM:SS) - null if unavailable all day
  is_available: boolean; // false for unavailable, true for available with specific hours
  reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ConflictCheck {
  has_conflict: boolean;
  conflict_type?: 'recurring' | 'exception' | 'time-off';
  message?: string;
  time_off_id?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
}

export interface NotificationSettings {
  id: string;
  restaurant_id: string;
  notify_time_off_request: boolean;
  notify_time_off_approved: boolean;
  notify_time_off_rejected: boolean;
  time_off_notify_managers: boolean;
  time_off_notify_employee: boolean;
  created_at: string;
  updated_at: string;
}

export type ChangeType = 'created' | 'updated' | 'deleted' | 'unpublished';

export interface ScheduleChangeLog {
  id: string;
  restaurant_id: string;
  shift_id: string | null;
  employee_id: string | null;
  change_type: ChangeType;
  changed_by: string;
  changed_at: string;
  reason: string | null;
  before_data: any;
  after_data: any;
  employee?: Employee;
}

export interface SchedulePublication {
  id: string;
  restaurant_id: string;
  week_start_date: string;
  week_end_date: string;
  published_at: string;
  published_by: string;
  notes: string | null;
  shift_count: number;
}

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
  employee?: Employee; // Joined data
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
