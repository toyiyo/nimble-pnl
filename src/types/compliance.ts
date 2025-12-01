export type ComplianceRuleType = 
  | 'minor_restrictions'
  | 'clopening'
  | 'rest_period'
  | 'shift_length'
  | 'overtime';

export type ViolationSeverity = 'warning' | 'error' | 'critical';
export type ViolationStatus = 'active' | 'resolved' | 'overridden';

// Configuration structures for different rule types
export interface MinorRestrictionsConfig {
  min_age?: number; // Minimum age to work
  max_hours_per_day: number; // Max hours per day for minors
  max_hours_per_week: number; // Max hours per week for minors
  earliest_start_time?: string; // e.g., "06:00"
  latest_end_time?: string; // e.g., "22:00"
  school_night_restrictions?: boolean; // Different rules for school nights
  school_night_max_hours?: number;
}

export interface ClopeningConfig {
  min_hours_between_shifts: number; // Minimum hours between close and open shifts
  allow_override: boolean; // Whether managers can override
}

export interface RestPeriodConfig {
  min_hours_between_shifts: number; // Minimum rest period between any shifts
  min_hours_per_week?: number; // Minimum hours off per week
  allow_override: boolean;
}

export interface ShiftLengthConfig {
  min_hours: number; // Minimum shift length
  max_hours: number; // Maximum shift length
  max_consecutive_days?: number; // Max days working in a row
  required_break_duration?: number; // Required break minutes for shifts over X hours
  required_break_threshold?: number; // Hours threshold that triggers break requirement
}

export interface OvertimeConfig {
  daily_threshold?: number; // Hours per day before overtime
  weekly_threshold: number; // Hours per week before overtime (default 40)
  consecutive_days_threshold?: number; // Days worked in a row that trigger OT
  warn_only: boolean; // Just warn or prevent scheduling
}

export type ComplianceRuleConfig = 
  | MinorRestrictionsConfig
  | ClopeningConfig
  | RestPeriodConfig
  | ShiftLengthConfig
  | OvertimeConfig;

export interface ComplianceRule {
  id: string;
  restaurant_id: string;
  rule_type: ComplianceRuleType;
  rule_config: ComplianceRuleConfig;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ViolationDetails {
  rule_type: ComplianceRuleType;
  severity: ViolationSeverity;
  message: string;
  previous_shift_end?: string;
  hours_between?: number;
  shift_duration_hours?: number;
  employee_age?: number;
  [key: string]: unknown; // Allow additional fields
}

export interface ComplianceViolation {
  id: string;
  restaurant_id: string;
  shift_id: string | null;
  employee_id: string;
  rule_type: ComplianceRuleType;
  violation_details: ViolationDetails;
  severity: ViolationSeverity;
  status: ViolationStatus;
  override_reason?: string;
  overridden_by?: string;
  overridden_at?: string;
  created_at: string;
  updated_at: string;
  // Joined data
  employee?: {
    id: string;
    name: string;
    position: string;
  };
  shift?: {
    id: string;
    start_time: string;
    end_time: string;
    position: string;
  };
}

export interface ComplianceCheckResult {
  hasViolations: boolean;
  violations: ViolationDetails[];
  canOverride: boolean;
  requiresOverride: boolean;
}

export interface ComplianceDashboardMetrics {
  totalViolations: number;
  activeViolations: number;
  overriddenViolations: number;
  violationsByType: Record<ComplianceRuleType, number>;
  violationsBySeverity: Record<ViolationSeverity, number>;
  violationTrend: Array<{
    date: string;
    count: number;
  }>;
  topViolators: Array<{
    employee_id: string;
    employee_name: string;
    violation_count: number;
  }>;
}
