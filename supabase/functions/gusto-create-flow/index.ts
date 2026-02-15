// Gusto Create Flow Edge Function
// Generates Flow URLs for embedded Gusto UI components

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createGustoClientWithRefresh, getGustoConfig, GustoConnection } from '../_shared/gustoClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Valid flow types supported by Gusto API
// See: https://docs.gusto.com/embedded-payroll/docs/flow-types
const VALID_FLOW_TYPES = [
  'company_onboarding',
  'add_employees',
  'add_contractors',
  'run_payroll',
  'employee_self_management',
  'add_addresses',
  'sign_all_forms',
  'federal_tax_setup',
  'state_tax_setup',
] as const;

type FlowType = typeof VALID_FLOW_TYPES[number];

interface CreateFlowRequest {
  restaurantId: string;
  flowType: FlowType;
  entityUuid?: string; // Required for employee/contractor onboarding
  entityType?: 'Employee' | 'Contractor' | 'Company';
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

    const body: CreateFlowRequest = await req.json();
    const { restaurantId, flowType, entityUuid, entityType } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    console.log('[GUSTO-FLOW] Received flow type:', flowType);

    if (!flowType || !VALID_FLOW_TYPES.includes(flowType)) {
      throw new Error(`Invalid flow type '${flowType}'. Must be one of: ${VALID_FLOW_TYPES.join(', ')}`);
    }

    // Validate entity requirements for individual onboarding flows
    // Note: add_employees and add_contractors don't require entity_uuid
    // employee_self_management requires an employee UUID
    if (flowType === 'employee_self_management' && !entityUuid) {
      throw new Error('Entity UUID is required for employee_self_management flow');
    }

    // Authorization check depends on flow type
    if (flowType === 'employee_self_management') {
      // For employee self-management flows, verify the user is linked to this employee
      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('id')
        .eq('gusto_employee_uuid', entityUuid)
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .single();

      if (employeeError || !employee) {
        // Fall back to owner/manager check - they can also access employee flows
        const { data: userRestaurant, error: accessError } = await supabase
          .from('user_restaurants')
          .select('role')
          .eq('user_id', user.id)
          .eq('restaurant_id', restaurantId)
          .in('role', ['owner', 'manager'])
          .single();

        if (accessError || !userRestaurant) {
          throw new Error('Access denied: You can only access your own onboarding flow');
        }
      }
    } else {
      // For other flows, require owner or manager role
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

    console.log('[GUSTO-FLOW] Creating flow:', flowType, 'for company:', connection.company_uuid);

    // Create the flow
    const flowResponse = await gustoClient.createFlow(
      connection.company_uuid,
      flowType,
      entityUuid,
      entityType
    );

    console.log('[GUSTO-FLOW] Flow response:', JSON.stringify(flowResponse));

    return new Response(JSON.stringify({
      success: true,
      url: flowResponse.url,
      flowUrl: flowResponse.url, // Also send as flowUrl for compatibility
      expires_at: flowResponse.expires_at,
      expiresAt: flowResponse.expires_at, // Also send as expiresAt for compatibility
      flowType,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-FLOW] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
