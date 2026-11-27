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
import { disconnectProvider, runIntegrationDisconnect } from '@/lib/runIntegrationDisconnect';

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

describe('disconnectProvider', () => {
  beforeEach(() => {
    rpc.mockReset();
    notify.mockReset();
  });

  function args(over: Partial<Parameters<typeof disconnectProvider>[0]> = {}) {
    return {
      integration: 'square' as const,
      name: 'Square',
      currentId: 'r1',
      hasConnection: true,
      clearLocalState: vi.fn(),
      toast: vi.fn(),
      ...over,
    };
  }

  it('disconnects the current restaurant and clears the local state', async () => {
    rpc.mockResolvedValue('evt-1');
    const a = args();
    await disconnectProvider(a);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 'r1', integration: 'square' }));
    expect(a.clearLocalState).toHaveBeenCalledTimes(1);
    expect(a.toast).toHaveBeenCalledWith({ title: 'Disconnected', description: 'Successfully disconnected from Square' });
  });

  it('keeps the local state when the target is another restaurant', async () => {
    rpc.mockResolvedValue('evt-2');
    const a = args({ targetId: 'r2', hasConnection: false });
    await disconnectProvider(a);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 'r2' }));
    expect(a.clearLocalState).not.toHaveBeenCalled();
  });

  it('clears the local state when the current restaurant is already disconnected', async () => {
    rpc.mockRejectedValue(new AlreadyDisconnectedError());
    const a = args({ name: 'Clover', integration: 'clover' });
    await disconnectProvider(a);
    expect(a.clearLocalState).toHaveBeenCalledTimes(1);
    expect(a.toast).toHaveBeenCalledWith({ title: 'Already disconnected', description: 'Clover was already disconnected' });
  });

  it.each([
    ['no restaurant', { currentId: null }],
    ['no connection and no target', { hasConnection: false }],
  ])('does nothing with %s', async (_label, over) => {
    const a = args(over);
    await disconnectProvider(a);
    expect(rpc).not.toHaveBeenCalled();
    expect(a.toast).not.toHaveBeenCalled();
  });
});
