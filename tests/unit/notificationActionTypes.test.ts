import { describe, it, expect } from 'vitest';
import {
  SHIFT_ACTION_TYPE,
  TRADE_ACTION_TYPE,
  TIME_OFF_ACTION_TYPE,
} from '../../supabase/functions/_shared/notificationActionTypes';
import { NOTIFICATION_TYPES, type NotificationType } from '../../src/lib/notificationTypes';

const CATALOG_KEYS = new Set<NotificationType>(NOTIFICATION_TYPES.map((t) => t.key));
const channelsFor = (key: NotificationType) =>
  NOTIFICATION_TYPES.find((t) => t.key === key)!.channels;

describe('SHIFT_ACTION_TYPE', () => {
  it('maps all three shift actions to distinct catalog keys', () => {
    expect(SHIFT_ACTION_TYPE).toEqual({
      created: 'shift_created',
      modified: 'shift_modified',
      deleted: 'shift_deleted',
    });
  });

  it('every mapped type is a real catalog key that gates both email and push', () => {
    for (const type of Object.values(SHIFT_ACTION_TYPE)) {
      expect(CATALOG_KEYS.has(type)).toBe(true);
      expect(channelsFor(type)).toEqual(expect.arrayContaining(['email', 'push']));
    }
  });
});

describe('TRADE_ACTION_TYPE', () => {
  it('maps all five trade actions to distinct catalog keys', () => {
    expect(TRADE_ACTION_TYPE).toEqual({
      created: 'shift_trade_created',
      accepted: 'shift_trade_accepted',
      approved: 'shift_trade_approved',
      rejected: 'shift_trade_rejected',
      cancelled: 'shift_trade_cancelled',
    });
  });

  it('every mapped type is a real catalog key that gates both email and push', () => {
    for (const type of Object.values(TRADE_ACTION_TYPE)) {
      expect(CATALOG_KEYS.has(type)).toBe(true);
      expect(channelsFor(type)).toEqual(expect.arrayContaining(['email', 'push']));
    }
  });
});

describe('TIME_OFF_ACTION_TYPE', () => {
  it('maps all three time-off actions to distinct catalog keys', () => {
    expect(TIME_OFF_ACTION_TYPE).toEqual({
      created: 'time_off_requested',
      approved: 'time_off_approved',
      rejected: 'time_off_rejected',
    });
  });

  it('the "created" (request-submitted) type is email-only, matching the catalog', () => {
    expect(channelsFor(TIME_OFF_ACTION_TYPE.created)).toEqual(['email']);
  });

  it('the approved/rejected types gate both email and push', () => {
    expect(channelsFor(TIME_OFF_ACTION_TYPE.approved)).toEqual(expect.arrayContaining(['email', 'push']));
    expect(channelsFor(TIME_OFF_ACTION_TYPE.rejected)).toEqual(expect.arrayContaining(['email', 'push']));
  });
});
