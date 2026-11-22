// Input checks and event recording for stripe-disconnect-bank.
// Design: docs/superpowers/specs/2026-11-21-integration-disconnect-events-design.md 4.4.

export const DISCONNECT_REASONS = [
  'switching_pos',
  'credentials_changed',
  'temporary_close',
  'no_value',
  'too_expensive',
  'other',
] as const;

export const REASON_TEXT_MAX = 500;

export interface DisconnectBankOptions {
  reason: string | null;
  reasonText: string | null;
  recordEvent: boolean;
}

export type ParseResult =
  | { ok: true; value: DisconnectBankOptions }
  | { ok: false; error: string };

const isPresent = (value: unknown): boolean => value !== null && value !== undefined;

// Cut by code point to match the SQL char_length check. Slice a bounded prefix first.
// Each code point uses at most 2 UTF-16 units, so 2 * max units keep enough code points.
function truncateByCodePoints(text: string, max: number): string {
  return Array.from(text.trim().slice(0, max * 2)).slice(0, max).join('');
}

export function parseDisconnectBankInput(body: Record<string, unknown>): ParseResult {
  const { reason, reasonText, recordEvent } = body;

  if (isPresent(reason) && !(DISCONNECT_REASONS as readonly string[]).includes(reason as string)) {
    return { ok: false, error: 'Invalid reason' };
  }
  if (isPresent(reasonText) && typeof reasonText !== 'string') {
    return { ok: false, error: 'Invalid reasonText' };
  }
  if (isPresent(recordEvent) && typeof recordEvent !== 'boolean') {
    return { ok: false, error: 'Invalid recordEvent' };
  }

  const trimmed = typeof reasonText === 'string' ? truncateByCodePoints(reasonText, REASON_TEXT_MAX) : '';
  return {
    ok: true,
    value: {
      reason: (reason as string | null | undefined) ?? null,
      reasonText: trimmed === '' ? null : trimmed,
      recordEvent: recordEvent === true,
    },
  };
}

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface RecordBankEventArgs {
  restaurantId: string;
  actorUserId: string;
  reason: string | null;
  reasonText: string | null;
  institutionName: string | null;
  stripeAccountId: string;
}

// Call only after the Stripe disconnect succeeds. A failure never blocks the disconnect.
export async function recordBankDisconnectEvent(
  client: RpcClient,
  args: RecordBankEventArgs,
): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('record_integration_event', {
      p_restaurant_id: args.restaurantId,
      p_integration: 'bank',
      p_event: 'disconnect',
      p_actor_user_id: args.actorUserId,
      p_reason: args.reason,
      p_reason_text: args.reasonText,
      p_details: {
        institution_name: args.institutionName,
        stripe_financial_connections_account_id: args.stripeAccountId,
      },
    });
    if (error) {
      console.error('[DISCONNECT-BANK] record_integration_event failed', error.message);
      return null;
    }
    return (data as string | null) ?? null;
  } catch (e) {
    console.error('[DISCONNECT-BANK] record_integration_event threw', e instanceof Error ? e.message : e);
    return null;
  }
}
