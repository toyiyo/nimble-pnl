export interface Employee {
  id: string;
  restaurant_id: string;
  name: string;
  email?: string;
  phone?: string;
  position: string;
  hourly_rate: number; // In cents
  status: 'active' | 'inactive' | 'terminated';
  hire_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
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

export interface SchedulePublication {
  id: string;
  restaurant_id: string;
  week_start_date: string;
  week_end_date: string;
  published_by: string;
  published_at: string;
  shift_count: number;
  notification_sent: boolean;
  notes?: string;
  created_at: string;
}

export type ChangeType = 'created' | 'updated' | 'deleted' | 'unpublished';

export interface ScheduleChangeLog {
  id: string;
  restaurant_id: string;
  shift_id?: string | null;
  employee_id?: string | null;
  change_type: ChangeType;
  changed_by: string;
  changed_at: string;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
  reason?: string;
  created_at: string;
  employee?: Employee; // Joined data
}
