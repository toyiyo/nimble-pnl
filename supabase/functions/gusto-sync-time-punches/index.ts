// Gusto Sync Time Punches Edge Function
// Syncs time punches from EasyShiftHQ to Gusto as time activities

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createGustoClient, getGustoConfig, GustoApiError } from '../_shared/gustoClient.ts';

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
  };
}

interface WorkPeriod {
  employeeId: string;
  gustoEmployeeUuid: string;
  date: string; // YYYY-MM-DD
  hours: number; // Decimal hours
  isContractor: boolean;
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

    // Create Gusto client with decrypted token
    const gustoClient = await createGustoClient(connection.access_token, gustoConfig.baseUrl);

    // Fetch time punches for the date range
    // Join with employees to get Gusto UUID
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
      .not('employees.gusto_employee_uuid', 'is', null) // Only employees synced to Gusto
      .order('punch_time', { ascending: true });

    if (punchesError) {
      throw new Error(`Failed to fetch time punches: ${punchesError.message}`);
    }

    if (!timePunches || timePunches.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No time punches to sync',
        punchesSynced: 0,
        workPeriods: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[GUSTO-TIME] Processing ${timePunches.length} punches for ${effectiveStartDate} to ${effectiveEndDate}`);

    // Group punches by employee and calculate work periods
    const workPeriods = calculateWorkPeriods(timePunches as unknown as TimePunch[]);

    if (workPeriods.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No complete work periods found to sync',
        punchesSynced: timePunches.length,
        workPeriods: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[GUSTO-TIME] Found ${workPeriods.length} work periods to sync`);

    // Convert work periods to Gusto time activities format
    const timeActivities = workPeriods.map(wp => ({
      employee_uuid: wp.gustoEmployeeUuid,
      date: wp.date,
      hours: wp.hours.toFixed(2), // Gusto expects string with 2 decimal places
      activity_type: 'regular', // Regular hours
      description: 'Synced from EasyShiftHQ time tracking',
    }));

    // Batch send to Gusto
    try {
      const response = await gustoClient.createTimeActivities(
        connection.company_uuid,
        { time_activities: timeActivities }
      );

      console.log(`[GUSTO-TIME] Successfully synced ${timeActivities.length} time activities`);

      // Update last synced timestamp
      await supabase
        .from('gusto_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', connection.id);

      return new Response(JSON.stringify({
        success: true,
        message: `Synced ${timeActivities.length} work periods to Gusto`,
        punchesSynced: timePunches.length,
        workPeriods: workPeriods.length,
        timeActivities: timeActivities.length,
        dateRange: {
          start: effectiveStartDate,
          end: effectiveEndDate,
        },
        gustoResponse: response,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      if (error instanceof GustoApiError) {
        console.error(`[GUSTO-TIME] Gusto API error:`, error);
        throw new Error(`Gusto API error (${error.status}): ${error.message}`);
      }
      throw error;
    }

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
 * Calculate work periods from time punches
 * Groups punches by employee and date, pairs clock_in/clock_out to calculate hours
 */
function calculateWorkPeriods(punches: TimePunch[]): WorkPeriod[] {
  const workPeriods: WorkPeriod[] = [];

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
    // Get employee info from first punch
    const employee = employeePunches[0].employees;

    if (!employee.gusto_employee_uuid) {
      console.log(`[GUSTO-TIME] Skipping employee ${employee.name} - not synced to Gusto`);
      continue;
    }

    // Group by date
    const byDate = new Map<string, TimePunch[]>();

    for (const punch of employeePunches) {
      const date = punch.punch_time.split('T')[0];
      if (!byDate.has(date)) {
        byDate.set(date, []);
      }
      byDate.get(date)!.push(punch);
    }

    // Calculate hours for each date
    for (const [date, datePunches] of byDate) {
      const hours = calculateHoursFromPunches(datePunches);

      if (hours > 0) {
        workPeriods.push({
          employeeId,
          gustoEmployeeUuid: employee.gusto_employee_uuid,
          date,
          hours,
          isContractor: employee.compensation_type === 'contractor',
        });
      }
    }
  }

  return workPeriods;
}

/**
 * Calculate total hours from a set of punches for a single day
 * Pairs clock_in with clock_out, subtracts breaks
 */
function calculateHoursFromPunches(punches: TimePunch[]): number {
  // Sort by time
  const sorted = punches.sort((a, b) =>
    new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  let totalMinutes = 0;
  let clockInTime: Date | null = null;
  let breakStartTime: Date | null = null;
  let breakMinutes = 0;

  for (const punch of sorted) {
    const punchTime = new Date(punch.punch_time);

    switch (punch.punch_type) {
      case 'clock_in':
        clockInTime = punchTime;
        breakMinutes = 0; // Reset break minutes for new shift
        break;

      case 'clock_out':
        if (clockInTime) {
          const workMinutes = (punchTime.getTime() - clockInTime.getTime()) / (1000 * 60);
          totalMinutes += workMinutes - breakMinutes;
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

  // Convert to hours and round to 2 decimal places
  const hours = Math.max(0, totalMinutes / 60);
  return Math.round(hours * 100) / 100;
}
