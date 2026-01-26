// Gusto Webhooks Edge Function
// Handles webhook events from Gusto for real-time updates

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from 'https://deno.land/std@0.177.0/node/crypto.ts';
import { logSecurityEvent } from '../_shared/encryption.ts';

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

    if (!signature) {
      console.warn('[GUSTO-WEBHOOK] No signature header present');
      // Continue processing but log the warning
      // In production, you may want to reject unsigned webhooks
    }

    const webhookSecret = Deno.env.get('GUSTO_WEBHOOK_SECRET');

    if (signature && webhookSecret && timestamp) {
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
        console.error('[GUSTO-WEBHOOK] Received:', signature.substring(0, 20) + '...');
        console.error('[GUSTO-WEBHOOK] Expected:', expectedSignature.substring(0, 20) + '...');

        // Log security event for invalid signature
        await logSecurityEvent(supabase, 'GUSTO_WEBHOOK_INVALID_SIGNATURE', undefined, undefined, {
          receivedSignature: signature.substring(0, 20),
        });

        // Continue processing but log the issue
        // In production, you may want to return 401
      }
    }

    // Parse the webhook payload
    const event: GustoWebhookEvent = JSON.parse(rawBody);

    console.log('[GUSTO-WEBHOOK] Received event:', event.event_type, 'for company:', event.company_uuid);

    // Check for duplicate event (idempotency)
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

    // Get restaurant_id from company_uuid
    const { data: restaurantId } = await supabase.rpc('get_restaurant_by_gusto_company', {
      p_company_uuid: event.company_uuid,
    });

    if (!restaurantId) {
      console.warn('[GUSTO-WEBHOOK] No restaurant found for company:', event.company_uuid);
      // Still store the event for debugging
    }

    // Store the webhook event
    await supabase
      .from('gusto_webhook_events')
      .insert({
        event_uuid: event.uuid,
        event_type: event.event_type,
        company_uuid: event.company_uuid,
        restaurant_id: restaurantId || null,
        raw_payload: event,
      });

    // Process the event based on type
    await processEvent(supabase, event, restaurantId);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[GUSTO-WEBHOOK] Error processing webhook:', error);

    // Always return 200 to prevent Gusto from retrying
    // Log the error for debugging
    return new Response(JSON.stringify({
      received: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 200, // Return 200 even on error to prevent retries
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Process webhook event based on type
 */
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
    // ============================================================
    // Employee events
    // ============================================================
    case 'employee.created':
      console.log('[GUSTO-WEBHOOK] New employee created in Gusto:', event.entity_uuid);
      // A new employee was created in Gusto (possibly via Gusto Flow)
      // We could create a corresponding employee in EasyShiftHQ
      // For now, just log it - the user can manually sync if needed
      break;

    case 'employee.updated':
      console.log('[GUSTO-WEBHOOK] Employee updated in Gusto:', event.entity_uuid);
      // Update the employee's onboarding status if they exist locally
      await supabase
        .from('employees')
        .update({ gusto_onboarding_status: 'updated_in_gusto' })
        .eq('gusto_employee_uuid', event.entity_uuid)
        .eq('restaurant_id', restaurantId);
      break;

    case 'employee.terminated':
      console.log('[GUSTO-WEBHOOK] Employee terminated in Gusto:', event.entity_uuid);
      // Mark the employee as terminated locally
      await supabase
        .from('employees')
        .update({
          gusto_onboarding_status: 'terminated',
          // Optionally also update status
          // status: 'terminated',
        })
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

    // ============================================================
    // Payroll events
    // ============================================================
    case 'payroll.submitted':
      console.log('[GUSTO-WEBHOOK] Payroll submitted:', event.entity_uuid);
      // Payroll was submitted for processing
      await upsertPayrollRun(supabase, restaurantId, event.entity_uuid, 'pending');
      break;

    case 'payroll.processed':
      console.log('[GUSTO-WEBHOOK] Payroll processed:', event.entity_uuid);
      // Payroll was fully processed
      await upsertPayrollRun(supabase, restaurantId, event.entity_uuid, 'processed');
      break;

    case 'payroll.paid':
      console.log('[GUSTO-WEBHOOK] Payroll paid:', event.entity_uuid);
      // Employees have been paid
      await upsertPayrollRun(supabase, restaurantId, event.entity_uuid, 'approved');
      break;

    // ============================================================
    // Company events
    // ============================================================
    case 'company.provisioned':
      console.log('[GUSTO-WEBHOOK] Company provisioned:', event.entity_uuid);
      // Company setup is complete
      await supabase
        .from('gusto_connections')
        .update({ onboarding_status: 'completed' })
        .eq('company_uuid', event.entity_uuid)
        .eq('restaurant_id', restaurantId);
      break;

    case 'company.updated':
      console.log('[GUSTO-WEBHOOK] Company updated:', event.entity_uuid);
      // Company info was updated - could fetch new details if needed
      break;

    // ============================================================
    // Form completion events
    // ============================================================
    case 'form.i9_completed':
      console.log('[GUSTO-WEBHOOK] I-9 form completed for employee:', event.entity_uuid);
      break;

    case 'form.w4_completed':
      console.log('[GUSTO-WEBHOOK] W-4 form completed for employee:', event.entity_uuid);
      break;

    // ============================================================
    // Contractor events
    // ============================================================
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

/**
 * Upsert a payroll run record
 */
async function upsertPayrollRun(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  payrollUuid: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('gusto_payroll_runs')
    .upsert({
      restaurant_id: restaurantId,
      gusto_payroll_uuid: payrollUuid,
      status,
      pay_period_start: new Date().toISOString().split('T')[0], // Placeholder
      pay_period_end: new Date().toISOString().split('T')[0], // Placeholder
      check_date: new Date().toISOString().split('T')[0], // Placeholder
      synced_at: new Date().toISOString(),
    }, {
      onConflict: 'restaurant_id,gusto_payroll_uuid',
    });

  if (error) {
    console.error('[GUSTO-WEBHOOK] Error upserting payroll run:', error);
  }
}
