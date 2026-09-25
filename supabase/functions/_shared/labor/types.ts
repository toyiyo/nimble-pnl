/**
 * Input types of the shared labor engine.
 *
 * The engine runs in the browser (through the `src/` shims) and in the Deno
 * edge functions. It must not import the `src/` UI types. Each input type
 * here names only the fields that the engine reads or writes. The full UI
 * types in `src/types/` are structural supersets, so `tsc` checks each call.
 */

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
  start_time: string;
  end_time: string;
  /** In minutes. It can be null at runtime (the column has no NOT NULL). */
  break_duration: number;
}
