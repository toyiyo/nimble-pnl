import { describe, it, expect, vi } from 'vitest';
import {
  DISCONNECT_REASONS,
  parseDisconnectBankInput,
  recordBankDisconnectEvent,
} from '../../supabase/functions/_shared/disconnectBankInput';

describe('parseDisconnectBankInput', () => {
  it('accepts every reason in the list', () => {
    for (const reason of DISCONNECT_REASONS) {
      const r = parseDisconnectBankInput({ bankId: 'b1', reason });
      expect(r).toEqual(expect.objectContaining({ ok: true }));
    }
  });

  it('returns an error for a reason outside the list', () => {
    const r = parseDisconnectBankInput({ bankId: 'b1', reason: 'bad' });
    expect(r.ok).toBe(false);
  });

  it('trims reasonText and caps it at 500 characters', () => {
    const r = parseDisconnectBankInput({ bankId: 'b1', reasonText: `  ${'a'.repeat(600)}  ` });
    expect(r.ok && r.value.reasonText).toHaveLength(500);
    const t = parseDisconnectBankInput({ bankId: 'b1', reasonText: '  hi  ' });
    expect(t.ok && t.value.reasonText).toBe('hi');
  });

  it('cuts reasonText by code points and keeps a whole emoji at the limit', () => {
    const r = parseDisconnectBankInput({ bankId: 'b1', reasonText: `${'a'.repeat(499)}😀😀` });
    expect(r.ok && r.value.reasonText).toBe(`${'a'.repeat(499)}😀`);
  });

  it('returns an error when reasonText is not a string', () => {
    expect(parseDisconnectBankInput({ bankId: 'b1', reasonText: 5 }).ok).toBe(false);
  });

  it('returns an error when recordEvent is not a boolean', () => {
    expect(parseDisconnectBankInput({ bankId: 'b1', recordEvent: 'yes' }).ok).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats %s in every optional field as absent', (_label, v) => {
    const r = parseDisconnectBankInput({ bankId: 'b1', reason: v, reasonText: v, recordEvent: v });
    expect(r.ok && r.value).toEqual({ reason: null, reasonText: null, recordEvent: false });
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   \n\t '],
  ])('stores null for %s reasonText', (_label, reasonText) => {
    const r = parseDisconnectBankInput({ bankId: 'b1', reasonText });
    expect(r.ok && r.value.reasonText).toBeNull();
  });

  it.each([
    ['reason', 0],
    ['reason', -1],
    ['reasonText', 0],
    ['reasonText', -1],
    ['recordEvent', 0],
    ['recordEvent', -1],
  ])('returns an error when %s is the number %s', (field, v) => {
    expect(parseDisconnectBankInput({ bankId: 'b1', [field]: v }).ok).toBe(false);
  });

  it('sets recordEvent only for the literal true', () => {
    const on = parseDisconnectBankInput({ bankId: 'b1', recordEvent: true });
    const off = parseDisconnectBankInput({ bankId: 'b1', recordEvent: false });
    expect(on.ok && on.value.recordEvent).toBe(true);
    expect(off.ok && off.value.recordEvent).toBe(false);
  });

  it('defaults optional fields', () => {
    const r = parseDisconnectBankInput({ bankId: 'b1' });
    expect(r.ok && r.value).toEqual({
      reason: null,
      reasonText: null,
      recordEvent: false,
    });
  });
});

describe('recordBankDisconnectEvent', () => {
  const args = {
    restaurantId: 'r1',
    actorUserId: 'u1',
    reason: 'other',
    reasonText: 'x',
    institutionName: 'Chase',
    stripeAccountId: 'fca_1',
  };

  it('calls record_integration_event and returns the event id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'evt-1', error: null });
    const id = await recordBankDisconnectEvent({ rpc }, args);
    expect(id).toBe('evt-1');
    expect(rpc).toHaveBeenCalledWith('record_integration_event', {
      p_restaurant_id: 'r1',
      p_integration: 'bank',
      p_event: 'disconnect',
      p_actor_user_id: 'u1',
      p_reason: 'other',
      p_reason_text: 'x',
      p_details: {
        institution_name: 'Chase',
        stripe_financial_connections_account_id: 'fca_1',
      },
    });
  });

  it('returns null when the RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await recordBankDisconnectEvent({ rpc }, args)).toBeNull();
  });

  it('returns null when the RPC throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('net'));
    expect(await recordBankDisconnectEvent({ rpc }, args)).toBeNull();
  });
});
