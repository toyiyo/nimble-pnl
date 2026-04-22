import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatExpiresIn, classifyInvitationError } from '@/lib/invitationUtils';

describe('formatExpiresIn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Expires in 3 days" for a future date 3 days away', () => {
    const future = new Date('2026-04-24T12:00:00Z').toISOString();
    expect(formatExpiresIn(future)).toBe('Expires in 3 days');
  });

  it('returns "Expires tomorrow" for a future date 1 day away', () => {
    const tomorrow = new Date('2026-04-22T12:00:00Z').toISOString();
    expect(formatExpiresIn(tomorrow)).toBe('Expires tomorrow');
  });

  it('returns "Expires today" when less than 1 day remains', () => {
    const soonish = new Date('2026-04-21T18:00:00Z').toISOString();
    expect(formatExpiresIn(soonish)).toBe('Expires today');
  });

  it('returns "Expired yesterday" for yesterday', () => {
    const yesterday = new Date('2026-04-20T12:00:00Z').toISOString();
    expect(formatExpiresIn(yesterday)).toBe('Expired yesterday');
  });

  it('returns "Expired 5 days ago" for 5 days past', () => {
    const past = new Date('2026-04-16T12:00:00Z').toISOString();
    expect(formatExpiresIn(past)).toBe('Expired 5 days ago');
  });
});

describe('classifyInvitationError', () => {
  it('returns "expired" for the exact expired message', () => {
    expect(classifyInvitationError('Invitation has expired')).toBe('expired');
  });

  it('returns "invalid" for any other message', () => {
    expect(classifyInvitationError('Invalid token')).toBe('invalid');
    expect(classifyInvitationError('')).toBe('invalid');
    expect(classifyInvitationError('Not found')).toBe('invalid');
  });
});
