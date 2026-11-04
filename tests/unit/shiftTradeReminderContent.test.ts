import { describe, it, expect } from 'vitest';
import {
  buildEmployeeReminderPush,
  buildSchedulerUnclaimedPush,
  buildPosterUnclaimedPush,
  buildSchedulerUnclaimedEmail,
  firstName,
  reminderDay,
  reminderWhen,
  formatTimeRange,
  type ReminderShiftInfo,
} from '../../supabase/functions/_shared/shiftTradeReminderContent';
import { TENTATIVE_NOTE } from '../../supabase/functions/_shared/draftTradeNote';
import { tradeLinkHref } from '../../supabase/functions/_shared/tradeDeepLinkUrl';

const CHICAGO = 'America/Chicago';
// Friday 2026-09-25 10:00 in Chicago (CDT, UTC-5).
const NOW = new Date('2026-09-25T15:00:00Z');

function info(over: Partial<ReminderShiftInfo> = {}): ReminderShiftInfo {
  return {
    tradeId: 'trade-1',
    restaurantId: 'rest-1',
    restaurantName: 'Blue Fig',
    restaurantTimezone: CHICAGO,
    // Friday 17:00 to 23:00 in Chicago.
    startTime: '2026-09-25T22:00:00Z',
    endTime: '2026-09-26T04:00:00Z',
    position: 'Server',
    isPublished: true,
    posterName: 'Maria Lopez',
    ...over,
  };
}

describe('firstName', () => {
  it('returns the first word of the poster name', () => {
    expect(firstName('Maria Lopez')).toBe('Maria');
    expect(firstName('  Ana  ')).toBe('Ana');
  });

  it('falls back to "A teammate" for an empty name', () => {
    expect(firstName('')).toBe('A teammate');
    expect(firstName(null)).toBe('A teammate');
  });
});

describe('reminderDay', () => {
  it('returns "today" for the same restaurant day', () => {
    expect(reminderDay(new Date('2026-09-25T22:00:00Z'), NOW, CHICAGO)).toBe('today');
  });

  it('returns "tomorrow" for the next restaurant day', () => {
    expect(reminderDay(new Date('2026-09-26T22:00:00Z'), NOW, CHICAGO)).toBe('tomorrow');
  });

  it('returns the weekday name for a later day', () => {
    expect(reminderDay(new Date('2026-09-27T22:00:00Z'), NOW, CHICAGO)).toBe('Sunday');
  });

  it('uses the restaurant day at midnight, not the UTC day', () => {
    // Now: Fri 23:30 Chicago. Start: Sat 00:30 Chicago. Both are Sep 26 in UTC.
    const now = new Date('2026-09-26T04:30:00Z');
    expect(reminderDay(new Date('2026-09-26T05:30:00Z'), now, CHICAGO)).toBe('tomorrow');
  });

  it('uses the restaurant zone when it differs from UTC', () => {
    // Now: Sat 00:00 Tokyo. Start: Sat 09:00 Tokyo. In UTC, now is Friday.
    const now = new Date('2026-09-25T15:00:00Z');
    expect(reminderDay(new Date('2026-09-26T00:00:00Z'), now, 'Asia/Tokyo')).toBe('today');
  });

  it('falls back to America/Chicago for a bad zone', () => {
    expect(reminderDay(new Date('2026-09-25T22:00:00Z'), NOW, 'Not/AZone')).toBe('today');
  });
});

describe('reminderWhen', () => {
  it('uses whole hours, rounded down', () => {
    expect(reminderWhen(new Date('2026-09-25T20:59:00Z'), NOW)).toBe('in 5 hours');
  });

  it('uses the singular for one hour', () => {
    expect(reminderWhen(new Date('2026-09-25T16:30:00Z'), NOW)).toBe('in 1 hour');
  });

  it('uses minutes under one hour', () => {
    expect(reminderWhen(new Date('2026-09-25T15:45:00Z'), NOW)).toBe('in 45 minutes');
    expect(reminderWhen(new Date('2026-09-25T15:01:00Z'), NOW)).toBe('in 1 minute');
  });

  it('never says "0 minutes": under one minute left shows "in 1 minute"', () => {
    expect(reminderWhen(new Date('2026-09-25T15:00:30Z'), NOW)).toBe('in 1 minute');
    expect(reminderWhen(NOW, NOW)).toBe('in 1 minute');
    expect(reminderWhen(new Date('2026-09-25T14:59:00Z'), NOW)).toBe('in 1 minute');
  });
});

describe('formatTimeRange', () => {
  it('shows one period when both ends share it', () => {
    expect(formatTimeRange(new Date('2026-09-25T22:00:00Z'), new Date('2026-09-26T04:00:00Z'), CHICAGO)).toBe('5–11 PM');
  });

  it('shows both periods when they differ, and keeps minutes', () => {
    expect(formatTimeRange(new Date('2026-09-25T15:30:00Z'), new Date('2026-09-25T21:00:00Z'), CHICAGO)).toBe('10:30 AM–4 PM');
  });

  it('shows midnight as 12 AM', () => {
    expect(formatTimeRange(new Date('2026-09-26T05:00:00Z'), new Date('2026-09-26T09:00:00Z'), CHICAGO)).toBe('12–4 AM');
  });
});

describe('buildEmployeeReminderPush', () => {
  it('72h: title "{name} needs cover {day}" and the free-then body', () => {
    const push = buildEmployeeReminderPush(
      info({ startTime: '2026-09-27T22:00:00Z', endTime: '2026-09-28T04:00:00Z' }),
      '72h',
      NOW,
    );
    expect(push.title).toBe('Maria needs cover Sunday');
    expect(push.body).toBe("Server, Sun 5–11 PM. You're free then. Tap to take the shift.");
  });

  it('24h: title uses "tomorrow"', () => {
    const push = buildEmployeeReminderPush(
      info({ startTime: '2026-09-26T22:00:00Z', endTime: '2026-09-27T04:00:00Z' }),
      '24h',
      NOW,
    );
    expect(push.title).toBe('Maria needs cover tomorrow');
    expect(push.body).toBe("Server, Sat 5–11 PM. You're free then. Tap to take the shift.");
  });

  it('24h: title uses "today" for the same restaurant day', () => {
    expect(buildEmployeeReminderPush(info(), '24h', NOW).title).toBe('Maria needs cover today');
  });

  it('6h: title "{name}\'s shift starts {when}" from the real hours left', () => {
    const push = buildEmployeeReminderPush(info(), '6h', new Date('2026-09-25T17:30:00Z'));
    expect(push.title).toBe("Maria's shift starts in 4 hours");
    expect(push.body).toBe("Server, Fri 5–11 PM. You're free then. Tap to take the shift.");
  });

  it('links to the marketplace with trade, restaurant and from=reminder', () => {
    const push = buildEmployeeReminderPush(info(), '24h', NOW);
    expect(push.url).toBe('/employee/shifts?trade=trade-1&restaurant=rest-1&from=reminder');
    expect(push.url).toBe(tradeLinkHref('trade-1', 'rest-1', 'reminder'));
  });

  it('tags the push with the trade id', () => {
    expect(buildEmployeeReminderPush(info(), '72h', NOW).tag).toBe('trade-reminder-trade-1');
  });

  it('adds the tentative note for a draft shift', () => {
    const push = buildEmployeeReminderPush(info({ isPublished: false }), '24h', NOW);
    expect(push.body).toBe(`Server, Fri 5–11 PM. You're free then. Tap to take the shift. ${TENTATIVE_NOTE}`);
  });
});

describe('buildSchedulerUnclaimedPush', () => {
  it('uses the scheduler title, body, URL and tag', () => {
    const push = buildSchedulerUnclaimedPush(info());
    expect(push).toEqual({
      title: "Nobody took Maria's shift yet",
      body: 'Server, Fri 5–11 PM, still open. Tap to assign it.',
      url: '/scheduling',
      tag: 'trade-unclaimed-trade-1',
    });
  });

  it('adds the tentative note for a draft shift', () => {
    const push = buildSchedulerUnclaimedPush(info({ isPublished: false }));
    expect(push.body).toBe(`Server, Fri 5–11 PM, still open. Tap to assign it. ${TENTATIVE_NOTE}`);
  });
});

describe('push tags', () => {
  it('uses a separate tag for the unclaimed stage, so it does not replace an employee reminder', () => {
    expect(buildEmployeeReminderPush(info(), '24h', NOW).tag).toBe('trade-reminder-trade-1');
    expect(buildSchedulerUnclaimedPush(info()).tag).toBe('trade-unclaimed-trade-1');
    expect(buildPosterUnclaimedPush(info()).tag).toBe('trade-unclaimed-trade-1');
  });
});

describe('buildPosterUnclaimedPush', () => {
  it('uses the poster title, body, URL and tag', () => {
    expect(buildPosterUnclaimedPush(info())).toEqual({
      title: 'Your shift is still up for trade',
      body: 'Nobody took it yet. You still work it unless a manager changes it.',
      url: '/employee/schedule',
      tag: 'trade-unclaimed-trade-1',
    });
  });
});

describe('buildSchedulerUnclaimedEmail', () => {
  const APP_URL = 'https://app.easyshifthq.com';

  it('uses the scheduler subject and links to /scheduling', () => {
    const email = buildSchedulerUnclaimedEmail(info(), NOW, APP_URL);
    expect(email.subject).toBe("Nobody took Maria's shift yet");
    expect(email.html).toContain(`${APP_URL}/scheduling`);
    expect(email.html).toContain('Blue Fig');
    expect(email.html).toContain('5–11 PM');
  });

  it('escapes the poster, position and restaurant names', () => {
    const email = buildSchedulerUnclaimedEmail(
      info({ posterName: '<b>Al</b> Smith', position: 'Bar & <i>Grill</i>', restaurantName: '<script>x</script>' }),
      NOW,
      APP_URL,
    );
    expect(email.html).not.toContain('<b>Al</b>');
    expect(email.html).not.toContain('<i>Grill</i>');
    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).toContain('&lt;b&gt;Al&lt;/b&gt;');
    expect(email.html).toContain('Bar &amp; &lt;i&gt;Grill&lt;/i&gt;');
  });

  it('adds the tentative note for a draft shift', () => {
    const email = buildSchedulerUnclaimedEmail(info({ isPublished: false }), NOW, APP_URL);
    expect(email.html).toContain(TENTATIVE_NOTE);
  });
});
