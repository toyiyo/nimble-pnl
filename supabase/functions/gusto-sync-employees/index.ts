// Gusto Sync Employees Edge Function
// Syncs employees from EasyShiftHQ to Gusto

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createGustoClientWithRefresh, getGustoConfig, GustoApiError, GustoConnection } from '../_shared/gustoClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncEmployeesRequest {
  restaurantId: string;
  employeeIds?: string[]; // Optional: sync specific employees
  selfOnboarding?: boolean; // Whether to enable self-onboarding for employees
}

interface SyncResult {
  synced: number;
  skipped: number;
  errors: Array<{
    employeeId: string;
    employeeName: string;
    error: string;
  }>;
}

interface EasyShiftEmployee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string;
  hire_date: string | null;
  gusto_employee_uuid: string | null;
  gusto_sync_status: string;
  is_active: boolean;
  compensation_type: string;
  hourly_rate: number | null;
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

    const body: SyncEmployeesRequest = await req.json();
    const { restaurantId, employeeIds, selfOnboarding = true } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

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

    // Create Gusto client with automatic token refresh
    const gustoClient = await createGustoClientWithRefresh(
      connection as GustoConnection,
      gustoConfig,
      supabase
    );

    // Build employee query
    let employeeQuery = supabase
      .from('employees')
      .select('id, name, email, phone, position, hire_date, gusto_employee_uuid, gusto_sync_status, is_active, compensation_type, hourly_rate')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true); // Only sync active employees

    // If specific employee IDs provided, filter to those
    if (employeeIds && employeeIds.length > 0) {
      employeeQuery = employeeQuery.in('id', employeeIds);
    } else {
      // Otherwise, sync employees that haven't been synced yet
      employeeQuery = employeeQuery.or('gusto_sync_status.is.null,gusto_sync_status.eq.not_synced,gusto_sync_status.eq.error');
    }

    const { data: employees, error: employeesError } = await employeeQuery;

    if (employeesError) {
      throw new Error(`Failed to fetch employees: ${employeesError.message}`);
    }

    if (!employees || employees.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No employees to sync',
        synced: 0,
        skipped: 0,
        errors: [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[GUSTO-SYNC] Syncing ${employees.length} employees to Gusto company ${connection.company_uuid}`);

    const result: SyncResult = {
      synced: 0,
      skipped: 0,
      errors: [],
    };

    // Process each employee
    for (const employee of employees as EasyShiftEmployee[]) {
      try {
        // Skip if already synced and not forced
        if (employee.gusto_employee_uuid && !employeeIds?.includes(employee.id)) {
          result.skipped++;
          continue;
        }

        // Mark as pending
        const { error: pendingError } = await supabase
          .from('employees')
          .update({ gusto_sync_status: 'pending' })
          .eq('id', employee.id);

        if (pendingError) {
          console.error(`[GUSTO-SYNC] Failed to mark employee ${employee.name} as pending:`, pendingError.message);
        }

        // Parse name into first/last
        const nameParts = employee.name.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0];

        // Determine if this should be an employee or contractor in Gusto
        const isContractor = employee.compensation_type === 'contractor';

        let gustoUuid: string;
        let onboardingStatus: string;

        if (isContractor) {
          // Create as contractor
          const contractorData = {
            type: 'Individual' as const,
            first_name: firstName,
            last_name: lastName,
            email: employee.email || undefined,
            self_onboarding: selfOnboarding,
          };

          console.log(`[GUSTO-SYNC] Creating contractor in Gusto: ${firstName} ${lastName}`);

          const gustoContractor = await gustoClient.createContractor(
            connection.company_uuid,
            contractorData
          );

          gustoUuid = gustoContractor.uuid;
          onboardingStatus = gustoContractor.is_active ? 'onboarding_completed' : 'self_onboarding_pending_invite';
        } else {
          // Create as employee
          const employeeData = {
            first_name: firstName,
            last_name: lastName,
            email: employee.email || undefined,
            self_onboarding: selfOnboarding,
          };

          console.log(`[GUSTO-SYNC] Creating employee in Gusto: ${firstName} ${lastName}`);

          const gustoEmployee = await gustoClient.createEmployee(
            connection.company_uuid,
            employeeData
          );

          gustoUuid = gustoEmployee.uuid;
          onboardingStatus = gustoEmployee.onboarding_status;

          // Update the primary job with title and rate if available
          const primaryJob = gustoEmployee.jobs?.find(j => j.primary) || gustoEmployee.jobs?.[0];
          if (primaryJob && (employee.position || employee.hourly_rate)) {
            const jobUpdates: Record<string, string> = {};

            if (employee.position) {
              jobUpdates.title = employee.position;
            }
            if (employee.hourly_rate && employee.hourly_rate > 0) {
              jobUpdates.rate = employee.hourly_rate.toFixed(2);
              jobUpdates.payment_unit = 'Hour';
            }

            try {
              await gustoClient.updateJob(primaryJob.uuid, primaryJob.version, jobUpdates);
              console.log(`[GUSTO-SYNC] Updated job for ${employee.name}: title=${employee.position}, rate=${employee.hourly_rate}`);
            } catch (jobError) {
              // Log but don't fail the sync - employee was created successfully
              console.warn(`[GUSTO-SYNC] Failed to update job for ${employee.name}:`, jobError);
            }
          }
        }

        // Update EasyShiftHQ employee with Gusto info
        const { error: syncedError } = await supabase
          .from('employees')
          .update({
            gusto_employee_uuid: gustoUuid,
            gusto_synced_at: new Date().toISOString(),
            gusto_sync_status: 'synced',
            gusto_onboarding_status: onboardingStatus,
          })
          .eq('id', employee.id);

        if (syncedError) {
          console.error(`[GUSTO-SYNC] Failed to mark employee ${employee.name} as synced:`, syncedError.message);
        }

        result.synced++;
        console.log(`[GUSTO-SYNC] Successfully synced employee ${employee.name} -> ${gustoUuid}`);

      } catch (error) {
        const errorMessage = error instanceof GustoApiError
          ? `Gusto API error (${error.status}): ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Unknown error';

        console.error(`[GUSTO-SYNC] Error syncing employee ${employee.name}:`, errorMessage);

        // Mark as error
        const { error: markErrorError } = await supabase
          .from('employees')
          .update({ gusto_sync_status: 'error' })
          .eq('id', employee.id);

        if (markErrorError) {
          console.error(`[GUSTO-SYNC] Failed to mark employee ${employee.name} as error:`, markErrorError.message);
        }

        result.errors.push({
          employeeId: employee.id,
          employeeName: employee.name,
          error: errorMessage,
        });
      }
    }

    // Update last synced timestamp
    await supabase
      .from('gusto_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    console.log(`[GUSTO-SYNC] Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${result.synced} employees to Gusto`,
      ...result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-SYNC] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
