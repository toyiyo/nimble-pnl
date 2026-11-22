import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/integrationDisconnect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/integrationDisconnect')>(
    '@/lib/integrationDisconnect',
  );
  return {
    ...actual,
    disconnectIntegration: vi.fn(),
    notifyIntegrationDisconnect: vi.fn(),
  };
});

import {
  AlreadyDisconnectedError,
  disconnectIntegration,
  notifyIntegrationDisconnect,
} from '@/lib/integrationDisconnect';
import { runIntegrationDisconnect } from '@/lib/runIntegrationDisconnect';

const rpc = vi.mocked(disconnectIntegration);
const notify = vi.mocked(notifyIntegrationDisconnect);
const messages = { success: 'Done text', already: 'Already text' };

function setup() {
  const onDisconnected = vi.fn();
  const toast = vi.fn();
  return { onDisconnected, toast };
}

describe('runIntegrationDisconnect', () => {
  beforeEach(() => {
    rpc.mockReset();
    notify.mockReset();
  });

  it('calls the RPC with the reason and clears the state on success', async () => {
    rpc.mockResolvedValue('evt-1');
    const { onDisconnected, toast } = setup();
    await runIntegrationDisconnect({
      restaurantId: 'r1',
      integration: 'square',
      opts: { reason: 'other', reasonText: 'why' },
      onDisconnected,
      toast,
      messages,
    });
    expect(rpc).toHaveBeenCalledWith({
      restaurantId: 'r1',
      integration: 'square',
      reason: 'other',
      reasonText: 'why',
    });
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: 'Disconnected', description: 'Done text' });
    expect(notify).toHaveBeenCalledWith('evt-1');
  });

  it('sends null for a missing reason and missing text', async () => {
    rpc.mockResolvedValue('evt-2');
    const { onDisconnected, toast } = setup();
    await runIntegrationDisconnect({ restaurantId: 'r1', integration: 'toast', onDisconnected, toast, messages });
    expect(rpc).toHaveBeenCalledWith({ restaurantId: 'r1', integration: 'toast', reason: null, reasonText: null });
  });

  it('treats AlreadyDisconnectedError as a success and sends no alert', async () => {
    rpc.mockRejectedValue(new AlreadyDisconnectedError());
    const { onDisconnected, toast } = setup();
    await expect(
      runIntegrationDisconnect({ restaurantId: 'r1', integration: 'clover', onDisconnected, toast, messages }),
    ).resolves.toBeUndefined();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: 'Already disconnected', description: 'Already text' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('rethrows other errors and changes nothing', async () => {
    const boom = new Error('boom');
    rpc.mockRejectedValue(boom);
    const { onDisconnected, toast } = setup();
    await expect(
      runIntegrationDisconnect({ restaurantId: 'r1', integration: 'focus', onDisconnected, toast, messages }),
    ).rejects.toBe(boom);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not wait for the alert', async () => {
    rpc.mockResolvedValue('evt-3');
    notify.mockReturnValue(new Promise(() => {}));
    const { onDisconnected, toast } = setup();
    await runIntegrationDisconnect({ restaurantId: 'r1', integration: 'revel', onDisconnected, toast, messages });
    expect(notify).toHaveBeenCalledWith('evt-3');
  });
});
