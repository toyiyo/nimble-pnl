export interface TimePunch {
  id: string;
  restaurant_id: string;
  employee_id: string;
  shift_id?: string;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  device_info?: string;
  photo_path?: string; // Storage path in time-clock-photos bucket (e.g., restaurant_id/employee_id/punch-timestamp.jpg)
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  modified_by?: string;
  employee?: {
    id: string;
    name: string;
    position: string;
  };
}

export interface EmployeeTip {
  id: string;
  restaurant_id: string;
  employee_id: string;
  shift_id?: string;
  tip_amount: number; // In cents
  tip_source: 'cash' | 'credit' | 'pool' | 'other';
  recorded_at: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface PunchStatus {
  is_clocked_in: boolean;
  last_punch_time: string | null;
  last_punch_type: string | null;
  on_break: boolean;
}

export interface EmployeePin {
  id: string;
  restaurant_id: string;
  employee_id: string;
  pin_hash: string;
  min_length: number;
  force_reset: boolean;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KioskSessionToken {
  location_id: string;
  kiosk_instance_id: string;
  manager_id_hash: string;
  kiosk_mode: boolean;
  started_at: string;
  require_manager_pin?: boolean;
  min_length?: number;
}

export interface WorkedHours {
  total_hours: number;
  regular_hours: number;
  break_hours: number;
}

export interface TimeCard {
  employee_id: string;
  employee_name: string;
  start_date: string;
  end_date: string;
  punches: TimePunch[];
  total_hours: number;
  regular_hours: number;
  break_hours: number;
  total_pay: number; // In cents
  tips: EmployeeTip[];
  total_tips: number; // In cents
}
