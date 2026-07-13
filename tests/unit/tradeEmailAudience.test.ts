import { describe, it, expect } from 'vitest';
import { resolveCreatedTradeEmailRecipients } from '../../supabase/functions/_shared/tradeEmailAudience';

describe('resolveCreatedTradeEmailRecipients', () => {
  it('directed trade with a target email returns only that email', () => {
    const result = resolveCreatedTradeEmailRecipients(
      { email: 'target@example.com' },
      ['broadcast1@example.com', 'broadcast2@example.com'],
    );

    expect(result).toEqual(['target@example.com']);
  });

  it('CRITICAL: directed trade with a null target email returns [] (never falls back to broadcast)', () => {
    const result = resolveCreatedTradeEmailRecipients(
      { email: null },
      ['broadcast1@example.com', 'broadcast2@example.com'],
    );

    expect(result).toEqual([]);
  });

  it('CRITICAL: directed trade with an undefined target email returns [] (never falls back to broadcast)', () => {
    const result = resolveCreatedTradeEmailRecipients(
      { email: undefined as unknown as null },
      ['broadcast1@example.com', 'broadcast2@example.com'],
    );

    expect(result).toEqual([]);
  });

  it('CRITICAL: directed trade with an empty-string target email returns [] (never falls back to broadcast)', () => {
    const result = resolveCreatedTradeEmailRecipients(
      { email: '' },
      ['broadcast1@example.com', 'broadcast2@example.com'],
    );

    expect(result).toEqual([]);
  });

  it('open marketplace trade (null directedTarget) returns the broadcast list verbatim', () => {
    const broadcastEmails = ['broadcast1@example.com', 'broadcast2@example.com'];

    const result = resolveCreatedTradeEmailRecipients(null, broadcastEmails);

    expect(result).toEqual(broadcastEmails);
  });

  it('open marketplace trade with an empty broadcast list returns []', () => {
    const result = resolveCreatedTradeEmailRecipients(null, []);

    expect(result).toEqual([]);
  });
});
