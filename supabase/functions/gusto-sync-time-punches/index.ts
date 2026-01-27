// Gusto Sync Time Punches Edge Function
// Syncs time punches from EasyShiftHQ to Gusto as time sheets
// Uses the new time_tracking/time_sheets API (replaces deprecated time_activities)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createGustoClientWithRefresh, getGustoConfig, GustoApiError, GustoConnection } from '../_shared/gustoClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncTimePunchesRequest {
  restaurantId: string;
  startDate?: string; // YYYY-MM-DD, defaults to yesterday
  endDate?: string; // YYYY-MM-DD, defaults to today
}

interface TimePunch {
  id: string;
  employee_id: string;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: string;
  employees: {
    id: string;
    name: string;
    gusto_employee_uuid: string | null;
    gusto_sync_status: string;
    compensation_type: string;
    jobs?: Array<{
      uuid: string;
      primary: boolean;
    }>;
  };
}

interface ShiftData {
  employeeId: string;
  gustoEmployeeUuid: string;
  jobUuid: string;
  date: string;
  shiftStartedAt: string;
  shiftEndedAt: string;
  regularHours: number;
  overtimeHours: number;
  doubleOvertimeHours: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Invalid authentication');
    }

    const body: SyncTimePunchesRequest = await req.json();
    const { restaurantId, startDate, endDate } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Default date range: yesterday to today
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const effectiveStartDate = startDate || yesterday.toISOString().split('T')[0];
    const effectiveEndDate = endDate || today.toISOString().split('T')[0];

    // Verify user has access to restaurant (owner or manager)
    const { data: userRestaurant, error: accessError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager'])
      .single();

    if (accessError || !userRestaurant) {
      throw new Error('Access denied to restaurant');
    }

    // Get restaurant timezone
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();

    const timezone = restaurant?.timezone || 'America/New_York';

    // Get Gusto connection for this restaurant
    const { data: connection, error: connectionError } = await supabase
      .from('gusto_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Restaurant is not connected to Gusto. Please connect first.');
    }

    // Get origin for environment detection
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');
    const gustoConfig = getGustoConfig(origin || undefined);

    // Create Gusto client with automatic token refresh
    const gustoClient = await createGustoClientWithRefresh(
      connection as GustoConnection,
      gustoConfig,
      supabase
    );

    // Fetch employees with their Gusto job UUIDs
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, gusto_employee_uuid')
      .eq('restaurant_id', restaurantId)
      .not('gusto_employee_uuid', 'is', null);

    if (employeesError) {
      throw new Error(`Failed to fetch employees: ${employeesError.message}`);
    }

    // Get Gusto employees to find their job UUIDs
    const gustoEmployees = await gustoClient.getEmployees(connection.company_uuid);
    const employeeJobMap = new Map<string, string>();

    for (const ge of gustoEmployees) {
      const primaryJob = ge.jobs?.find(j => j.primary) || ge.jobs?.[0];
      if (primaryJob) {
        employeeJobMap.set(ge.uuid, primaryJob.uuid);
      }
    }

    // Fetch time punches for the date range
    const { data: timePunches, error: punchesError } = await supabase
      .from('time_punches')
      .select(`
        id,
        employee_id,
        punch_type,
        punch_time,
        employees!inner (
          id,
          name,
          gusto_employee_uuid,
          gusto_sync_status,
          compensation_type
        )
      `)
      .eq('restaurant_id', restaurantId)
      .gte('punch_time', `${effectiveStartDate}T00:00:00`)
      .lte('punch_time', `${effectiveEndDate}T23:59:59`)
      .not('employees.gusto_employee_uuid', 'is', null)
      .order('punch_time', { ascending: true });

    if (punchesError) {
      throw new Error(`Failed to fetch time punches: ${punchesError.message}`);
    }

    if (!timePunches || timePunches.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No time punches to sync',
        shiftsSynced: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[GUSTO-TIME] Processing ${timePunches.length} punches for ${effectiveStartDate} to ${effectiveEndDate}`);

    // Calculate shifts from punches
    const shifts = calculateShiftsFromPunches(
      timePunches as unknown as TimePunch[],
      employeeJobMap
    );

    if (shifts.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No complete shifts found to sync',
        punchesProcessed: timePunches.length,
        shiftsSynced: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[GUSTO-TIME] Found ${shifts.length} shifts to sync`);

    // Sync each shift to Gusto
    let syncedCount = 0;
    const errors: Array<{ employeeId: string; error: string }> = [];

    for (const shift of shifts) {
      try {
        // Build entries array based on hours classification
        const entries: Array<{ hours_worked: number; pay_classification: string }> = [];

        if (shift.regularHours > 0) {
          entries.push({
            hours_worked: shift.regularHours,
            pay_classification: 'Regular',
          });
        }
        if (shift.overtimeHours > 0) {
          entries.push({
            hours_worked: shift.overtimeHours,
            pay_classification: 'Overtime',
          });
        }
        if (shift.doubleOvertimeHours > 0) {
          entries.push({
            hours_worked: shift.doubleOvertimeHours,
            pay_classification: 'Double Overtime',
          });
        }

        if (entries.length === 0) {
          console.log(`[GUSTO-TIME] Skipping shift with 0 hours for employee ${shift.employeeId}`);
          continue;
        }

        const timeSheetRequest = {
          entity_uuid: shift.gustoEmployeeUuid,
          entity_type: 'Employee' as const,
          job_uuid: shift.jobUuid,
          time_zone: timezone,
          shift_started_at: shift.shiftStartedAt,
          shift_ended_at: shift.shiftEndedAt,
          entries,
        };

        console.log(`[GUSTO-TIME] Creating time sheet:`, JSON.stringify(timeSheetRequest));

        await gustoClient.createTimeSheet(connection.company_uuid, timeSheetRequest);
        syncedCount++;

      } catch (error) {
        const errorMessage = error instanceof GustoApiError
          ? `Gusto API error (${error.status}): ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Unknown error';

        console.error(`[GUSTO-TIME] Error syncing shift for employee ${shift.employeeId}:`, errorMessage);
        errors.push({ employeeId: shift.employeeId, error: errorMessage });
      }
    }

    // Update last synced timestamp
    await supabase
      .from('gusto_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    console.log(`[GUSTO-TIME] Sync complete: ${syncedCount} shifts synced, ${errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${syncedCount} shifts to Gusto`,
      punchesProcessed: timePunches.length,
      shiftsSynced: syncedCount,
      errors: errors.length > 0 ? errors : undefined,
      dateRange: {
        start: effectiveStartDate,
        end: effectiveEndDate,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-TIME] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Calculate individual shifts from time punches
 * Groups punches by employee and pairs clock_in/clock_out
 */
function calculateShiftsFromPunches(
  punches: TimePunch[],
  employeeJobMap: Map<string, string>
): ShiftData[] {
  const shifts: ShiftData[] = [];

  // Group punches by employee
  const byEmployee = new Map<string, TimePunch[]>();

  for (const punch of punches) {
    const employeeId = punch.employee_id;
    if (!byEmployee.has(employeeId)) {
      byEmployee.set(employeeId, []);
    }
    byEmployee.get(employeeId)!.push(punch);
  }

  // Process each employee's punches
  for (const [employeeId, employeePunches] of byEmployee) {
    const employee = employeePunches[0].employees;

    if (!employee.gusto_employee_uuid) {
      console.log(`[GUSTO-TIME] Skipping employee ${employee.name} - not synced to Gusto`);
      continue;
    }

    const jobUuid = employeeJobMap.get(employee.gusto_employee_uuid);
    if (!jobUuid) {
      console.log(`[GUSTO-TIME] Skipping employee ${employee.name} - no job UUID found`);
      continue;
    }

    // Sort by time
    const sorted = employeePunches.sort((a, b) =>
      new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
    );

    // Find clock_in/clock_out pairs to create shifts
    let clockInTime: Date | null = null;
    let breakMinutes = 0;
    let breakStartTime: Date | null = null;

    for (const punch of sorted) {
      const punchTime = new Date(punch.punch_time);

      switch (punch.punch_type) {
        case 'clock_in':
          clockInTime = punchTime;
          breakMinutes = 0;
          break;

        case 'clock_out':
          if (clockInTime) {
            const totalMinutes = (punchTime.getTime() - clockInTime.getTime()) / (1000 * 60) - breakMinutes;
            const totalHours = Math.max(0, totalMinutes / 60);

            // Classify hours (basic overtime rules - can be customized)
            const regularHours = Math.min(totalHours, 8);
            const overtimeHours = totalHours > 8 ? Math.min(totalHours - 8, 4) : 0;
            const doubleOvertimeHours = totalHours > 12 ? totalHours - 12 : 0;

            if (totalHours > 0) {
              shifts.push({
                employeeId,
                gustoEmployeeUuid: employee.gusto_employee_uuid!,
                jobUuid,
                date: clockInTime.toISOString().split('T')[0],
                shiftStartedAt: clockInTime.toISOString(),
                shiftEndedAt: punchTime.toISOString(),
                regularHours: Math.round(regularHours * 100) / 100,
                overtimeHours: Math.round(overtimeHours * 100) / 100,
                doubleOvertimeHours: Math.round(doubleOvertimeHours * 100) / 100,
              });
            }

            clockInTime = null;
            breakMinutes = 0;
          }
          break;

        case 'break_start':
          breakStartTime = punchTime;
          break;

        case 'break_end':
          if (breakStartTime) {
            breakMinutes += (punchTime.getTime() - breakStartTime.getTime()) / (1000 * 60);
            breakStartTime = null;
          }
          break;
      }
    }
  }

  return shifts;
}
