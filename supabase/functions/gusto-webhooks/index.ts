import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from 'https://deno.land/std@0.177.0/node/crypto.ts';
import { logSecurityEvent } from '../_shared/encryption.ts';
import { createGustoClientWithRefresh, getGustoConfig, GustoConnection } from '../_shared/gustoClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gusto-signature, x-gusto-timestamp',
};

interface GustoWebhookEvent {
  uuid: string;
  event_type: string;
  resource_type: string;
  resource_uuid: string;
  entity_type: string;
  entity_uuid: string;
  timestamp: number;
  company_uuid: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Initialize Supabase client with service role (for bypassing RLS)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Get raw body for signature verification
    const rawBody = await req.text();

    // Verify webhook signature
    const signature = req.headers.get('x-gusto-signature');
    const timestamp = req.headers.get('x-gusto-timestamp');

    if (!signature || !timestamp) {
      console.error('[GUSTO-WEBHOOK] Missing signature or timestamp header');
      return new Response(JSON.stringify({ error: 'Missing signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const webhookSecret = Deno.env.get('GUSTO_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('[GUSTO-WEBHOOK] GUSTO_WEBHOOK_SECRET not configured');
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Reject stale events (replay protection — 5 minute window)
    const eventAge = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (eventAge > 300) {
      console.error('[GUSTO-WEBHOOK] Stale timestamp, age:', eventAge, 'seconds');
      return new Response(JSON.stringify({ error: 'Stale timestamp' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify HMAC-SHA256 signature
    // Gusto signs: timestamp + '.' + body
    const signaturePayload = `${timestamp}.${rawBody}`;
    const computedSignature = createHmac('sha256', webhookSecret)
      .update(signaturePayload)
      .digest('hex');

    // Gusto signature format: v1=<signature>
    const expectedSignature = `v1=${computedSignature}`;

    if (signature !== expectedSignature) {
      console.error('[GUSTO-WEBHOOK] Invalid signature');
      await logSecurityEvent(supabase, 'GUSTO_WEBHOOK_INVALID_SIGNATURE', undefined, undefined, {
        receivedSignature: signature.substring(0, 20),
      });
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse the webhook payload
    const event: GustoWebhookEvent = JSON.parse(rawBody);

    console.log('[GUSTO-WEBHOOK] Received event:', event.event_type, 'for company:', event.company_uuid);

    const { data: existingEvent } = await supabase
      .from('gusto_webhook_events')
      .select('id')
      .eq('event_uuid', event.uuid)
      .maybeSingle();

    if (existingEvent) {
      console.log('[GUSTO-WEBHOOK] Duplicate event, skipping:', event.uuid);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: restaurantId } = await supabase.rpc('get_restaurant_by_gusto_company', {
      p_company_uuid: event.company_uuid,
    });

    if (!restaurantId) {
      console.warn('[GUSTO-WEBHOOK] No restaurant found for company:', event.company_uuid);
      // Still store the event for debugging
    }

    await supabase
      .from('gusto_webhook_events')
      .insert({
        event_uuid: event.uuid,
        event_type: event.event_type,
        company_uuid: event.company_uuid,
        restaurant_id: restaurantId || null,
        raw_payload: event,
      });

    await processEvent(supabase, event, restaurantId);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-WEBHOOK] Error processing webhook:', error);

    // Return 200 even on error to prevent Gusto from retrying
    return new Response(JSON.stringify({
      received: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Get a Gusto API client for the given restaurant.
 * Returns null if no connection is found.
 */
async function getGustoClientForRestaurant(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string
) {
  const { data: connection } = await supabase
    .from('gusto_connections')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .single();

  if (!connection) return null;

  const gustoConfig = getGustoConfig();
  return createGustoClientWithRefresh(
    connection as GustoConnection,
    gustoConfig,
    supabase
  );
}

async function processEvent(
  supabase: ReturnType<typeof createClient>,
  event: GustoWebhookEvent,
  restaurantId: string | null
): Promise<void> {
  if (!restaurantId) {
    console.log('[GUSTO-WEBHOOK] Skipping event processing - no restaurant_id');
    return;
  }

  switch (event.event_type) {
    case 'employee.created': {
      const employeeUuid = event.entity_uuid;
      if (!employeeUuid) {
        console.log('[WEBHOOK] employee.created - missing entity_uuid, skipping');
        break;
      }

      const { data: existingEmployee } = await supabase
        .from('employees')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('gusto_employee_uuid', employeeUuid)
        .maybeSingle();

      if (existingEmployee) {
        console.log(`[WEBHOOK] employee.created - employee ${employeeUuid} already exists locally, skipping`);
        break;
      }

      try {
        const gustoClient = await getGustoClientForRestaurant(supabase, restaurantId);
        if (!gustoClient) {
          console.log('[WEBHOOK] employee.created - no Gusto connection found');
          break;
        }

        const gustoEmployee = await gustoClient.getEmployee(employeeUuid);
        const fullName = `${gustoEmployee.first_name} ${gustoEmployee.last_name}`.trim();
        const primaryJob = gustoEmployee.jobs?.find((j: { primary?: boolean }) => j.primary) || gustoEmployee.jobs?.[0];

        let hourlyRate: number | null = null;
        if (primaryJob?.payment_unit === 'Hour' && primaryJob.rate) {
          const parsed = Number.parseFloat(primaryJob.rate);
          hourlyRate = Number.isNaN(parsed) ? null : parsed;
        }

        await supabase
          .from('employees')
          .insert({
            restaurant_id: restaurantId,
            name: fullName,
            email: gustoEmployee.email,
            position: primaryJob?.title || 'Employee',
            hourly_rate: hourlyRate,
            gusto_employee_uuid: gustoEmployee.uuid,
            gusto_onboarding_status: gustoEmployee.onboarding_status,
            gusto_synced_at: new Date().toISOString(),
            gusto_sync_status: 'synced',
            status: 'active',
            is_active: true,
          });

        console.log(`[WEBHOOK] employee.created - created local employee for uuid: ${employeeUuid}`);
      } catch (err) {
        console.error(`[WEBHOOK] employee.created - failed to create local employee:`, err);
      }
      break;
    }

    case 'employee.updated':
      console.log('[GUSTO-WEBHOOK] Employee updated in Gusto:', event.entity_uuid);
      await syncEmployeeOnboardingStatus(supabase, restaurantId, event.entity_uuid);
      break;

    case 'employee.terminated':
      console.log('[GUSTO-WEBHOOK] Employee terminated in Gusto:', event.entity_uuid);
      await supabase
        .from('employees')
        .update({ gusto_onboarding_status: 'terminated' })
        .eq('gusto_employee_uuid', event.entity_uuid)
        .eq('restaurant_id', restaurantId);
      break;

    case 'employee.rehired':
      console.log('[GUSTO-WEBHOOK] Employee rehired in Gusto:', event.entity_uuid);
      await supabase
        .from('employees')
        .update({ gusto_onboarding_status: 'rehired' })
        .eq('gusto_employee_uuid', event.entity_uuid)
        .eq('restaurant_id', restaurantId);
      break;

    case 'payroll.submitted':
      console.log('[GUSTO-WEBHOOK] Payroll submitted:', event.entity_uuid);
      await upsertPayrollRun(supabase, restaurantId, event.entity_uuid, 'pending');
      break;

    case 'payroll.processed':
      console.log('[GUSTO-WEBHOOK] Payroll processed:', event.entity_uuid);
      await upsertPayrollRun(supabase, restaurantId, event.entity_uuid, 'processed');
      break;

    case 'payroll.paid':
      console.log('[GUSTO-WEBHOOK] Payroll paid:', event.entity_uuid);
      await upsertPayrollRun(supabase, restaurantId, event.entity_uuid, 'approved');
      break;

    case 'company.provisioned':
      console.log('[GUSTO-WEBHOOK] Company provisioned:', event.entity_uuid);
      await supabase
        .from('gusto_connections')
        .update({ onboarding_status: 'completed' })
        .eq('company_uuid', event.entity_uuid)
        .eq('restaurant_id', restaurantId);
      break;

    case 'company.updated':
      console.log('[GUSTO-WEBHOOK] Company updated:', event.entity_uuid);
      break;

    case 'form.i9_completed':
      console.log('[GUSTO-WEBHOOK] I-9 form completed for employee:', event.entity_uuid);
      break;

    case 'form.w4_completed':
      console.log('[GUSTO-WEBHOOK] W-4 form completed for employee:', event.entity_uuid);
      break;

    case 'contractor.onboarded':
      console.log('[GUSTO-WEBHOOK] Contractor onboarded:', event.entity_uuid);
      break;

    case 'contractor.deactivated':
      console.log('[GUSTO-WEBHOOK] Contractor deactivated:', event.entity_uuid);
      break;

    default:
      console.log('[GUSTO-WEBHOOK] Unhandled event type:', event.event_type);
  }
}

async function upsertPayrollRun(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  payrollUuid: string,
  status: string
): Promise<void> {
  let payPeriodStart: string | null = null;
  let payPeriodEnd: string | null = null;
  let checkDate: string | null = null;

  try {
    const gustoClient = await getGustoClientForRestaurant(supabase, restaurantId);
    if (gustoClient) {
      const payroll = await gustoClient.getPayroll(payrollUuid);
      if (payroll) {
        payPeriodStart = payroll.pay_period?.start_date || null;
        payPeriodEnd = payroll.pay_period?.end_date || null;
        checkDate = payroll.check_date || null;
      }
    }
  } catch (fetchErr) {
    console.warn('[GUSTO-WEBHOOK] Could not fetch payroll details, using fallback dates:', fetchErr);
  }

  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('gusto_payroll_runs')
    .upsert({
      restaurant_id: restaurantId,
      gusto_payroll_uuid: payrollUuid,
      status,
      pay_period_start: payPeriodStart || today,
      pay_period_end: payPeriodEnd || today,
      check_date: checkDate || today,
      synced_at: new Date().toISOString(),
    }, {
      onConflict: 'restaurant_id,gusto_payroll_uuid',
    });

  if (error) {
    console.error('[GUSTO-WEBHOOK] Error upserting payroll run:', error);
  }
}

async function syncEmployeeOnboardingStatus(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  gustoEmployeeUuid: string
): Promise<void> {
  try {
    const gustoClient = await getGustoClientForRestaurant(supabase, restaurantId);
    if (!gustoClient) {
      console.error('[GUSTO-WEBHOOK] No connection found for restaurant:', restaurantId);
      return;
    }

    const gustoEmployee = await gustoClient.getEmployee(gustoEmployeeUuid);

    const { error: updateError } = await supabase
      .from('employees')
      .update({
        gusto_onboarding_status: gustoEmployee.onboarding_status,
        gusto_synced_at: new Date().toISOString(),
      })
      .eq('gusto_employee_uuid', gustoEmployeeUuid)
      .eq('restaurant_id', restaurantId);

    if (updateError) {
      console.error('[GUSTO-WEBHOOK] Error updating employee onboarding status:', updateError);
    } else {
      console.log('[GUSTO-WEBHOOK] Updated employee onboarding status to:', gustoEmployee.onboarding_status);
    }
  } catch (error) {
    console.error('[GUSTO-WEBHOOK] Error syncing employee onboarding status:', error);
  }
}
