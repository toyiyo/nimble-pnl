import { supabase } from '@/integrations/supabase/client';

export type IntegrationKey =
  | 'revel'
  | 'toast'
  | 'square'
  | 'clover'
  | 'shift4'
  | 'focus'
  | 'bank';

export type DisconnectReason =
  | 'switching_pos'
  | 'credentials_changed'
  | 'temporary_close'
  | 'no_value'
  | 'too_expensive'
  | 'other';

export const DISCONNECT_REASON_LABELS: Record<DisconnectReason, string> = {
  switching_pos: 'I am switching to a different POS',
  credentials_changed: 'My credentials changed',
  temporary_close: 'We are closed for a while',
  no_value: 'I do not get value from it',
  too_expensive: 'It costs too much',
  other: 'Other',
};

export function getDisconnectReasonLabel(
  reason: DisconnectReason,
  kind: 'pos' | 'bank',
): string {
  if (kind === 'bank' && reason === 'switching_pos') {
    return 'I am switching to a different bank';
  }
  return DISCONNECT_REASON_LABELS[reason];
}

export class AlreadyDisconnectedError extends Error {
  constructor(message = 'Already disconnected') {
    super(message);
    this.name = 'AlreadyDisconnectedError';
  }
}

export interface DisconnectOptions {
  reason?: DisconnectReason | null;
  reasonText?: string | null;
}

export interface DisconnectIntegrationArgs {
  restaurantId: string;
  integration: IntegrationKey;
  reason?: DisconnectReason | null;
  reasonText?: string | null;
}

/** Call the RPC. Throw on error. Return the event id. */
export async function disconnectIntegration({
  restaurantId,
  integration,
  reason = null,
  reasonText = null,
}: DisconnectIntegrationArgs): Promise<string> {
  const { data, error } = await supabase.rpc('disconnect_integration', {
    p_restaurant_id: restaurantId,
    p_integration: integration,
    p_reason: reason,
    p_reason_text: reasonText,
  });
  if (error) {
    if ((error as { code?: string }).code === 'P0002') {
      throw new AlreadyDisconnectedError();
    }
    throw error;
  }
  return data as string;
}

/** Send the alert. Never throws. A skipped result is not an error. */
export async function notifyIntegrationDisconnect(eventId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('notify-integration-disconnect', {
      body: { eventId },
    });
    if (error) {
      console.error('notify-integration-disconnect failed', error);
    }
  } catch (err) {
    console.error('notify-integration-disconnect failed', err);
  }
}
