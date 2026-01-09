import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SecurityEventType = 
  | 'TOAST_BULK_SYNC_SUCCESS'
  | 'TOAST_BULK_SYNC_FAILED'
  | 'TOAST_WEBHOOK_RECEIVED'
  | 'TOAST_CONNECTION_CREATED'
  | 'TOAST_CONNECTION_UPDATED'
  | 'TOAST_CONNECTION_DELETED'
  | 'SQUARE_SYNC_SUCCESS'
  | 'SQUARE_SYNC_FAILED'
  | 'CLOVER_SYNC_SUCCESS'
  | 'CLOVER_SYNC_FAILED'
  | 'SHIFT4_SYNC_SUCCESS'
  | 'SHIFT4_SYNC_FAILED'
  | 'API_KEY_CREATED'
  | 'API_KEY_DELETED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT';

export interface SecurityEventMetadata {
  ordersProcessed?: number;
  restaurantGuid?: string;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  [key: string]: unknown;
}

/**
 * Logs a security event to the auth_audit_log table
 */
export async function logSecurityEvent(
  supabase: SupabaseClient,
  eventType: SecurityEventType | string,
  userId?: string,
  restaurantId?: string,
  metadata?: SecurityEventMetadata
): Promise<void> {
  try {
    const { error } = await supabase.from('auth_audit_log').insert({
      event_type: eventType,
      user_id: userId || '00000000-0000-0000-0000-000000000000', // System user UUID for automated processes
      restaurant_id: restaurantId || null,
      metadata: metadata || null,
    });

    if (error) {
      console.error(`Failed to log security event ${eventType}:`, error.message);
    }
  } catch (err) {
    // Don't let logging failures break the main flow
    console.error(`Error logging security event ${eventType}:`, err);
  }
}
