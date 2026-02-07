// Gusto Disconnect Edge Function
// Disconnects a restaurant from Gusto and optionally clears employee sync data

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DisconnectRequest {
  restaurantId: string;
  clearEmployeeGusto?: boolean; // Whether to clear gusto_employee_uuid from employees
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

    const body: DisconnectRequest = await req.json();
    const { restaurantId, clearEmployeeGusto = false } = body;

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

    // Get existing connection info for logging
    const { data: connection } = await supabase
      .from('gusto_connections')
      .select('company_uuid, company_name')
      .eq('restaurant_id', restaurantId)
      .single();

    if (!connection) {
      throw new Error('Restaurant is not connected to Gusto');
    }

    console.log('[GUSTO-DISCONNECT] Disconnecting restaurant:', restaurantId, 'from company:', connection.company_uuid);

    // Delete the connection (this will cascade delete webhook events via FK)
    const { error: deleteError } = await supabase
      .from('gusto_connections')
      .delete()
      .eq('restaurant_id', restaurantId);

    if (deleteError) {
      throw new Error(`Failed to delete connection: ${deleteError.message}`);
    }

    // Optionally clear Gusto data from employees
    if (clearEmployeeGusto) {
      console.log('[GUSTO-DISCONNECT] Clearing Gusto data from employees');

      const { error: updateError } = await supabase
        .from('employees')
        .update({
          gusto_employee_uuid: null,
          gusto_synced_at: null,
          gusto_sync_status: 'not_synced',
          gusto_onboarding_status: null,
        })
        .eq('restaurant_id', restaurantId);

      if (updateError) {
        console.error('[GUSTO-DISCONNECT] Error clearing employee Gusto data:', updateError);
        // Don't throw - the main disconnect succeeded
      }
    }

    // Delete payroll runs for this restaurant
    await supabase
      .from('gusto_payroll_runs')
      .delete()
      .eq('restaurant_id', restaurantId);

    // Log security event
    await logSecurityEvent(supabase, 'GUSTO_DISCONNECTED', user.id, restaurantId, {
      companyUuid: connection.company_uuid,
      companyName: connection.company_name,
      clearedEmployeeData: clearEmployeeGusto,
    });

    console.log('[GUSTO-DISCONNECT] Successfully disconnected restaurant:', restaurantId);

    return new Response(JSON.stringify({
      success: true,
      message: 'Successfully disconnected from Gusto',
      clearedEmployeeData: clearEmployeeGusto,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-DISCONNECT] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
