import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import {
  AlreadyDisconnectedError,
  DISCONNECT_REASON_LABELS,
  disconnectIntegration,
  notifyIntegrationDisconnect,
} from '@/lib/integrationDisconnect';

describe('disconnectIntegration', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it('calls the RPC with the right args and returns the event id', async () => {
    rpc.mockResolvedValue({ data: 'event-1', error: null });
    const id = await disconnectIntegration({
      restaurantId: 'r1',
      integration: 'revel',
      reason: 'no_value',
      reasonText: 'text',
    });
    expect(id).toBe('event-1');
    expect(rpc).toHaveBeenCalledWith('disconnect_integration', {
      p_restaurant_id: 'r1',
      p_integration: 'revel',
      p_reason: 'no_value',
      p_reason_text: 'text',
    });
  });

  it('sends null when reason and text are missing', async () => {
    rpc.mockResolvedValue({ data: 'event-2', error: null });
    await disconnectIntegration({ restaurantId: 'r1', integration: 'toast' });
    expect(rpc).toHaveBeenCalledWith('disconnect_integration', {
      p_restaurant_id: 'r1',
      p_integration: 'toast',
      p_reason: null,
      p_reason_text: null,
    });
  });

  it('passes other errors through', async () => {
    const error = { code: '42501', message: 'forbidden' };
    rpc.mockResolvedValue({ data: null, error });
    await expect(
      disconnectIntegration({ restaurantId: 'r1', integration: 'toast' }),
    ).rejects.toBe(error);
  });

  it('turns P0002 into AlreadyDisconnectedError', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'none' } });
    await expect(
      disconnectIntegration({ restaurantId: 'r1', integration: 'toast' }),
    ).rejects.toBeInstanceOf(AlreadyDisconnectedError);
  });
});

describe('notifyIntegrationDisconnect', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes the edge function with the event id', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await notifyIntegrationDisconnect('event-1');
    expect(invoke).toHaveBeenCalledWith('notify-integration-disconnect', {
      body: { eventId: 'event-1' },
    });
  });

  it('logs the returned error and does not throw', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(notifyIntegrationDisconnect('e')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not throw when invoke rejects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockRejectedValue(new Error('network'));
    await expect(notifyIntegrationDisconnect('e')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not log a skipped result as an error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockResolvedValue({ data: { skipped: 'already_alerted' }, error: null });
    await notifyIntegrationDisconnect('e');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('DISCONNECT_REASON_LABELS', () => {
  it('matches the design labels', () => {
    expect(DISCONNECT_REASON_LABELS).toEqual({
      switching_pos: 'I am switching to a different POS',
      credentials_changed: 'My credentials changed',
      temporary_close: 'We are closed for a while',
      no_value: 'I do not get value from it',
      too_expensive: 'It costs too much',
      other: 'Other',
    });
  });
});
