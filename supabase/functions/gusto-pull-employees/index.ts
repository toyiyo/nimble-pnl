// Gusto Pull Employees Edge Function
// Syncs employees FROM Gusto TO EasyShiftHQ (bidirectional sync)
// This handles employees created directly in Gusto that need to appear in EasyShiftHQ

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createGustoClient, getGustoConfig, GustoApiError } from '../_shared/gustoClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PullEmployeesRequest {
  restaurantId: string;
  syncMode?: 'all' | 'new_only' | 'status_only'; // Default: 'status_only'
}

interface PullResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    gustoUuid: string;
    name: string;
    error: string;
  }>;
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

    const body: PullEmployeesRequest = await req.json();
    const { restaurantId, syncMode = 'status_only' } = body;

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

    // Create Gusto client with decrypted token
    const gustoClient = await createGustoClient(connection.access_token, gustoConfig.baseUrl);

    // Fetch all employees from Gusto
    console.log('[GUSTO-PULL] Fetching employees from Gusto company:', connection.company_uuid);
    const gustoEmployees = await gustoClient.getEmployees(connection.company_uuid);

    console.log(`[GUSTO-PULL] Found ${gustoEmployees.length} employees in Gusto`);

    // Get existing employees with Gusto UUIDs
    const { data: existingEmployees, error: existingError } = await supabase
      .from('employees')
      .select('id, gusto_employee_uuid, name, email')
      .eq('restaurant_id', restaurantId);

    if (existingError) {
      throw new Error(`Failed to fetch existing employees: ${existingError.message}`);
    }

    // Create a map of Gusto UUID to local employee
    const gustoUuidToLocal = new Map(
      (existingEmployees || [])
        .filter(e => e.gusto_employee_uuid)
        .map(e => [e.gusto_employee_uuid, e])
    );

    const result: PullResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Process each Gusto employee
    for (const gustoEmployee of gustoEmployees) {
      try {
        const fullName = `${gustoEmployee.first_name} ${gustoEmployee.last_name}`.trim();
        const existingLocal = gustoUuidToLocal.get(gustoEmployee.uuid);

        if (existingLocal) {
          // Employee exists locally - update onboarding status
          if (syncMode === 'status_only' || syncMode === 'all') {
            const { error: updateError } = await supabase
              .from('employees')
              .update({
                gusto_onboarding_status: gustoEmployee.onboarding_status,
                gusto_synced_at: new Date().toISOString(),
                gusto_sync_status: 'synced',
              })
              .eq('id', existingLocal.id);

            if (updateError) {
              throw new Error(`Update failed: ${updateError.message}`);
            }

            result.updated++;
            console.log(`[GUSTO-PULL] Updated onboarding status for ${fullName}: ${gustoEmployee.onboarding_status}`);
          } else {
            result.skipped++;
          }
        } else if (syncMode === 'all' || syncMode === 'new_only') {
          // Employee doesn't exist locally - create them
          // Skip terminated employees
          if (gustoEmployee.terminated) {
            console.log(`[GUSTO-PULL] Skipping terminated employee: ${fullName}`);
            result.skipped++;
            continue;
          }

          // Determine position from jobs
          const primaryJob = gustoEmployee.jobs?.find(j => j.primary) || gustoEmployee.jobs?.[0];
          const position = primaryJob?.title || 'Employee';

          // Determine hourly rate (with NaN validation)
          let hourlyRate: number | null = null;
          if (primaryJob?.payment_unit === 'Hour' && primaryJob.rate) {
            const parsedRate = Number.parseFloat(primaryJob.rate);
            hourlyRate = Number.isNaN(parsedRate) ? null : parsedRate;
          }

          const { error: createError } = await supabase
            .from('employees')
            .insert({
              restaurant_id: restaurantId,
              name: fullName,
              email: gustoEmployee.email,
              position,
              hourly_rate: hourlyRate,
              gusto_employee_uuid: gustoEmployee.uuid,
              gusto_onboarding_status: gustoEmployee.onboarding_status,
              gusto_synced_at: new Date().toISOString(),
              gusto_sync_status: 'synced',
              status: 'active',
              is_active: true,
            });

          if (createError) {
            throw new Error(`Create failed: ${createError.message}`);
          }

          result.created++;
          console.log(`[GUSTO-PULL] Created new employee from Gusto: ${fullName}`);
        } else {
          result.skipped++;
        }
      } catch (error) {
        const errorMessage = error instanceof GustoApiError
          ? `Gusto API error (${error.status}): ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Unknown error';

        console.error(`[GUSTO-PULL] Error processing ${gustoEmployee.first_name} ${gustoEmployee.last_name}:`, errorMessage);

        result.errors.push({
          gustoUuid: gustoEmployee.uuid,
          name: `${gustoEmployee.first_name} ${gustoEmployee.last_name}`,
          error: errorMessage,
        });
      }
    }

    // Update last synced timestamp
    await supabase
      .from('gusto_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    console.log(`[GUSTO-PULL] Pull complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${result.created + result.updated} employees from Gusto`,
      ...result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-PULL] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
