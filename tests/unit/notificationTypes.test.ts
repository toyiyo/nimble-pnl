import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES, type NotificationType, type NotificationChannel } from '../../src/lib/notificationTypes';
import type { NotificationType as ResolverNotificationType } from '../../supabase/functions/_shared/resolveChannels';

// The resolver's NotificationType union isn't introspectable at runtime, so we
// hand-maintain a mirror list here purely for the drift check below. If this
// list and src/lib/notificationTypes.ts diverge, either this test or the
// exhaustiveness check further down will fail — forcing both files (and the
// migration's CHECK constraint, reviewed by hand) to be updated together.
const RESOLVER_TYPES: ResolverNotificationType[] = [
  'schedule_published',
  'shift_created',
  'shift_modified',
  'shift_deleted',
  'open_shifts_broadcast',
  'shift_trade_created',
  'shift_trade_accepted',
  'shift_trade_approved',
  'shift_trade_rejected',
  'shift_trade_cancelled',
  'time_off_requested',
  'time_off_approved',
  'time_off_rejected',
  'pin_reset',
  'availability_reminder',
  'open_shift_claim_reviewed',
];

// Compile-time guard: every catalog key must be assignable to the resolver's
// union (and vice versa via the mirror list above). If someone adds a key to
// one file and not the other, this line stops compiling.
function assertNotificationTypeAssignable(_key: NotificationType): ResolverNotificationType {
  return _key;
}
void assertNotificationTypeAssignable;

describe('NOTIFICATION_TYPES catalog', () => {
  it('has exactly 16 rows', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(16);
  });

  it('has no duplicate keys', () => {
    const keys = NOTIFICATION_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keys exactly match the resolver NotificationType union (drift guard)', () => {
    const catalogKeys = new Set(NOTIFICATION_TYPES.map((t) => t.key));
    const resolverKeys = new Set(RESOLVER_TYPES);
    expect(catalogKeys).toEqual(resolverKeys);
  });

  it('every row has a non-empty label and a known group', () => {
    const validGroups = new Set(['Scheduling', 'Trades', 'Time off', 'Access']);
    for (const t of NOTIFICATION_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(validGroups.has(t.group)).toBe(true);
    }
  });

  it('every row lists at least one channel, and only known channels', () => {
    const validChannels: NotificationChannel[] = ['email', 'push'];
    for (const t of NOTIFICATION_TYPES) {
      expect(t.channels.length).toBeGreaterThan(0);
      for (const ch of t.channels) {
        expect(validChannels).toContain(ch);
      }
      expect(new Set(t.channels).size).toBe(t.channels.length);
    }
  });

  it('email-only types (no push) are exactly time_off_requested, availability_reminder', () => {
    const emailOnly = NOTIFICATION_TYPES.filter((t) => !t.channels.includes('push')).map((t) => t.key).sort();
    expect(emailOnly).toEqual(['availability_reminder', 'time_off_requested'].sort());
  });

  it('every type supports email (no push-only types exist yet)', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(t.channels).toContain('email');
    }
  });

  it('does NOT include weekly_brief (per-user preference, out of scope for the admin matrix)', () => {
    const keys = NOTIFICATION_TYPES.map((t) => t.key);
    expect(keys).not.toContain('weekly_brief');
  });
});
