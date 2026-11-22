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

export interface DisconnectProviderArgs {
  integration: IntegrationKey;
  /** The name in the toasts, for example "Square". */
  name: string;
  opts?: DisconnectOptions;
  /** The restaurant the dialog named. It can differ from the current restaurant. */
  targetId?: string;
  currentId: string | null;
  hasConnection: boolean;
  /** Clears the hook state. Runs only when the target is the current restaurant. */
  clearLocalState: () => void;
  toast: RunIntegrationDisconnectArgs['toast'];
}

/** The disconnect for hooks that keep the connection in local state (Square, Clover). */
export async function disconnectProvider({
  integration,
  name,
  opts,
  targetId,
  currentId,
  hasConnection,
  clearLocalState,
  toast,
}: DisconnectProviderArgs): Promise<void> {
  const rid = targetId ?? currentId;
  if (!rid || (!targetId && !hasConnection)) return;
  await runIntegrationDisconnect({
    restaurantId: rid,
    integration,
    opts,
    toast,
    onDisconnected: () => {
      if (rid === currentId) clearLocalState();
    },
    messages: {
      success: `Successfully disconnected from ${name}`,
      already: `${name} was already disconnected`,
    },
  });
}
