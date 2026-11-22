import {
  AlreadyDisconnectedError,
  disconnectIntegration,
  notifyIntegrationDisconnect,
  type DisconnectOptions,
  type IntegrationKey,
} from '@/lib/integrationDisconnect';

// This module is separate from integrationDisconnect.ts so that hook tests can
// mock disconnectIntegration and notifyIntegrationDisconnect.

export interface RunIntegrationDisconnectArgs {
  restaurantId: string;
  integration: IntegrationKey;
  opts?: DisconnectOptions;
  /** Clears the local state. Runs after a disconnect and after "already disconnected". */
  onDisconnected: () => void;
  toast: (props: { title: string; description: string }) => void;
  messages: { success: string; already: string };
}

/**
 * Disconnects one integration through the RPC, then shows one toast.
 * Treats "already disconnected" as a success. Starts the alert without await.
 * Rethrows every other error.
 */
export async function runIntegrationDisconnect({
  restaurantId,
  integration,
  opts,
  onDisconnected,
  toast,
  messages,
}: RunIntegrationDisconnectArgs): Promise<void> {
  let eventId: string;
  try {
    eventId = await disconnectIntegration({
      restaurantId,
      integration,
      reason: opts?.reason ?? null,
      reasonText: opts?.reasonText ?? null,
    });
  } catch (err) {
    if (!(err instanceof AlreadyDisconnectedError)) throw err;
    onDisconnected();
    toast({ title: 'Already disconnected', description: messages.already });
    return;
  }
  onDisconnected();
  toast({ title: 'Disconnected', description: messages.success });
  void notifyIntegrationDisconnect(eventId);
}
