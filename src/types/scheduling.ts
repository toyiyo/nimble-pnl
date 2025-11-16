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
