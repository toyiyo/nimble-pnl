import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SquareWebhookSubscription {
  id: string;
  name: string;
  enabled: boolean;
  notification_url: string;
  event_types: string[];
  signature_key: string;
  created_at: string;
  updated_at: string;
}

interface WebhookSetupRequest {
  restaurantId?: string;
  action?: 'status' | 'create' | 'update' | 'cleanup';
}

/**
 * Square Webhook Registration
 *
 * IMPORTANT: There should only be ONE webhook subscription for the entire application.
 * All restaurants share this single webhook. The signature key is configured once
 * in SQUARE_WEBHOOK_SIGNATURE_KEY environment variable.
 *
 * Actions:
 * - status (default): Check if webhook exists and verify configuration
 * - create: Create the webhook (only if none exists) - ADMIN ACTION
 * - update: Update event types on existing webhook
 * - cleanup: Remove duplicate webhooks, keeping only the one matching our signature key
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: WebhookSetupRequest = await req.json().catch(() => ({}));
    const action = body.action || 'status';
    const restaurantId = body.restaurantId;

    console.log('Square webhook operation:', { action, restaurantId });

    const personalAccessToken = Deno.env.get('SQUARE_PERSONAL_ACCESS_TOKEN');
    const configuredSignatureKey = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY');

    if (!personalAccessToken) {
      throw new Error('SQUARE_PERSONAL_ACCESS_TOKEN not configured');
    }

    const apiBaseUrl = 'https://connect.squareup.com/v2';
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`;
    const webhookName = 'EasyShift Restaurant P&L Webhook';

    // Event types we subscribe to
    const requiredEventTypes = [
      'order.created',
      'order.updated',
      'payment.updated',
      'refund.updated',
      'inventory.count.updated'
    ];

    // Fetch all existing webhook subscriptions
    const listResponse = await fetch(`${apiBaseUrl}/webhooks/subscriptions`, {
      headers: {
        'Authorization': `Bearer ${personalAccessToken}`,
        'Square-Version': '2024-12-18',
      },
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Failed to list webhooks: ${listResponse.status} - ${errorText}`);
    }

    const webhooksData = await listResponse.json();
    const allSubscriptions: SquareWebhookSubscription[] = webhooksData.subscriptions || [];

    // Find webhooks pointing to our URL
    const ourWebhooks = allSubscriptions.filter(w => w.notification_url === webhookUrl);

    // Find the webhook that matches our configured signature key
    const matchingWebhook = configuredSignatureKey
      ? ourWebhooks.find(w => w.signature_key === configuredSignatureKey)
      : null;

    console.log('Webhook status:', {
      totalSubscriptions: allSubscriptions.length,
      webhooksForOurUrl: ourWebhooks.length,
      matchingSignatureKey: !!matchingWebhook,
      configuredSignatureKeySet: !!configuredSignatureKey
    });

    // Handle different actions
    if (action === 'status') {
      // Just report status - don't modify anything
      const status = {
        success: true,
        webhookUrl,
        configuredSignatureKeySet: !!configuredSignatureKey,
        totalWebhooksForUrl: ourWebhooks.length,
        matchingWebhook: matchingWebhook ? {
          id: matchingWebhook.id,
          name: matchingWebhook.name,
          enabled: matchingWebhook.enabled,
          eventTypes: matchingWebhook.event_types,
          hasAllRequiredEvents: requiredEventTypes.every(e => matchingWebhook.event_types?.includes(e))
        } : null,
        otherWebhooks: ourWebhooks.filter(w => w !== matchingWebhook).map(w => ({
          id: w.id,
          name: w.name,
          signatureKeyPrefix: w.signature_key?.substring(0, 10) + '...'
        })),
        recommendation: !configuredSignatureKey
          ? 'Set SQUARE_WEBHOOK_SIGNATURE_KEY env variable'
          : !matchingWebhook && ourWebhooks.length > 0
          ? 'Signature key mismatch - update SQUARE_WEBHOOK_SIGNATURE_KEY or run cleanup'
          : !matchingWebhook
          ? 'No webhook exists - run with action: "create"'
          : ourWebhooks.length > 1
          ? 'Multiple webhooks exist - run with action: "cleanup"'
          : 'Webhook configured correctly'
      };

      return new Response(JSON.stringify(status), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'cleanup') {
      // Remove webhooks that don't match our signature key
      if (!configuredSignatureKey) {
        throw new Error('Cannot cleanup without SQUARE_WEBHOOK_SIGNATURE_KEY configured');
      }

      const webhooksToDelete = ourWebhooks.filter(w => w.signature_key !== configuredSignatureKey);
      const deleted: string[] = [];

      for (const webhook of webhooksToDelete) {
        console.log('Deleting duplicate webhook:', webhook.id, webhook.name);
        const deleteResponse = await fetch(`${apiBaseUrl}/webhooks/subscriptions/${webhook.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${personalAccessToken}`,
            'Square-Version': '2024-12-18',
          },
        });

        if (deleteResponse.ok) {
          deleted.push(webhook.id);
        } else {
          console.error('Failed to delete webhook:', webhook.id, await deleteResponse.text());
        }
      }

      await logSecurityEvent(supabase, 'SQUARE_WEBHOOK_CLEANUP', undefined, restaurantId, {
        deletedCount: deleted.length,
        deletedIds: deleted
      });

      return new Response(JSON.stringify({
        success: true,
        action: 'cleanup',
        deletedCount: deleted.length,
        deletedIds: deleted,
        remainingWebhook: matchingWebhook?.id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create') {
      // Create webhook - only if none exists for our URL
      if (ourWebhooks.length > 0) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Webhook already exists for this URL',
          existingWebhooks: ourWebhooks.map(w => ({
            id: w.id,
            name: w.name,
            signatureKeyPrefix: w.signature_key?.substring(0, 10) + '...'
          })),
          hint: 'Use action: "cleanup" to remove duplicates, or update SQUARE_WEBHOOK_SIGNATURE_KEY to match existing webhook'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create new webhook
      const createResponse = await fetch(`${apiBaseUrl}/webhooks/subscriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${personalAccessToken}`,
          'Square-Version': '2024-12-18',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: {
            name: webhookName,
            notification_url: webhookUrl,
            event_types: requiredEventTypes,
            enabled: true
          }
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        throw new Error(`Failed to create webhook: ${createResponse.status} - ${errorData}`);
      }

      const webhookData = await createResponse.json();
      const newWebhook = webhookData.subscription;

      console.log('='.repeat(70));
      console.log('NEW WEBHOOK CREATED!');
      console.log('');
      console.log('IMPORTANT: Update your Supabase environment variable:');
      console.log('');
      console.log('  SQUARE_WEBHOOK_SIGNATURE_KEY=' + newWebhook.signature_key);
      console.log('');
      console.log('='.repeat(70));

      await logSecurityEvent(supabase, 'SQUARE_WEBHOOK_CREATED', undefined, restaurantId, {
        webhookId: newWebhook.id
      });

      return new Response(JSON.stringify({
        success: true,
        action: 'create',
        webhookId: newWebhook.id,
        signatureKey: newWebhook.signature_key,
        eventTypes: newWebhook.event_types,
        IMPORTANT: 'UPDATE YOUR ENVIRONMENT VARIABLE: SQUARE_WEBHOOK_SIGNATURE_KEY=' + newWebhook.signature_key
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update') {
      // Update event types on existing webhook
      if (!matchingWebhook) {
        throw new Error('No webhook found matching configured signature key');
      }

      const missingEvents = requiredEventTypes.filter(e => !matchingWebhook.event_types?.includes(e));

      if (missingEvents.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          action: 'update',
          message: 'Webhook already has all required event types',
          eventTypes: matchingWebhook.event_types
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const updateResponse = await fetch(`${apiBaseUrl}/webhooks/subscriptions/${matchingWebhook.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${personalAccessToken}`,
          'Square-Version': '2024-12-18',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: {
            name: webhookName,
            event_types: requiredEventTypes,
            enabled: true
          }
        }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.text();
        throw new Error(`Failed to update webhook: ${updateResponse.status} - ${errorData}`);
      }

      return new Response(JSON.stringify({
        success: true,
        action: 'update',
        webhookId: matchingWebhook.id,
        addedEventTypes: missingEvents,
        allEventTypes: requiredEventTypes
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Square webhook registration error:', message);

    return new Response(JSON.stringify({
      error: message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
