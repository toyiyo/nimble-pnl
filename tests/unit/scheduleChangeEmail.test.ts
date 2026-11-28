import { describe, it, expect } from 'vitest';
import { buildScheduleChangeEmail } from '../../supabase/functions/_shared/scheduleChangeEmail';
import type { ChangeLine } from '../../supabase/functions/_shared/scheduleNotificationDelivery';

const added: ChangeLine = { shiftId: 's1', kind: 'added', text: 'New shift: Mon, Jan 7, 10:00 AM – 6:00 PM (Server)', sortKey: '' };
const changed: ChangeLine = { shiftId: 's2', kind: 'changed', text: 'Changed: A → B', sortKey: '' };
const base = { employeeName: 'Ana', restaurantName: 'Cafe', lines: [added], appUrl: 'https://app.easyshifthq.com/employee/schedule' };

describe('buildScheduleChangeEmail', () => {
  it('lists each change line', () => {
    const { html } = buildScheduleChangeEmail(base);
    expect(html).toContain('<li>New shift: Mon, Jan 7, 10:00 AM – 6:00 PM (Server)</li>');
  });

  it('uses the new-schedule copy when every line is a new shift', () => {
    const email = buildScheduleChangeEmail(base);
    expect(email.subject).toBe('New schedule published at Cafe');
    expect(email.html).toContain('New Schedule Published');
  });

  it('uses the update copy when a line is a change or a removal', () => {
    const email = buildScheduleChangeEmail({ ...base, lines: [added, changed] });
    expect(email.subject).toBe('Schedule changes at Cafe');
    expect(email.html).toContain('Updated Schedule');
  });

  it('gives the same subject and body for the same row (stable for the idempotency key)', () => {
    expect(buildScheduleChangeEmail(base)).toEqual(buildScheduleChangeEmail({ ...base }));
  });

  it('escapes the employee name, the restaurant name, and the lines', () => {
    const { html } = buildScheduleChangeEmail({
      ...base,
      employeeName: '<b>x</b>',
      restaurantName: 'A & B',
      lines: [{ ...added, text: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('A &amp; B');
  });

  it('shows no list for no lines', () => {
    expect(buildScheduleChangeEmail({ ...base, lines: [] }).html).not.toContain('<ul');
  });
});
