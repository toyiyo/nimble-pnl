import { describe, it, expect } from 'vitest';
import {
  buildClaimNotificationContent,
  type ClaimNotifyInput,
} from '../../supabase/functions/_shared/openShiftClaimNotify';

const base: ClaimNotifyInput = {
  action: 'approved',
  employeeName: 'Jordan Lee',
  templateName: 'Morning Line',
  position: 'Cook',
  shiftDateLocal: 'Saturday, July 25, 2026',
  startTime: '09:00',
  endTime: '17:00',
  restaurantName: 'Taco Town',
  reviewerNote: null,
};

describe('buildClaimNotificationContent', () => {
  it('approved: subject/heading reflect approval', () => {
    const c = buildClaimNotificationContent({ ...base, action: 'approved' });
    expect(c.subject).toMatch(/approved/i);
    expect(c.heading).toMatch(/approved/i);
    expect(c.pushBody).toContain('Morning Line');
  });

  it('rejected: subject/heading reflect rejection', () => {
    const c = buildClaimNotificationContent({ ...base, action: 'rejected' });
    expect(c.subject).toMatch(/(rejected|declined)/i);
    expect(c.heading).toMatch(/(rejected|declined)/i);
  });

  it('includes the reviewer note when present', () => {
    const c = buildClaimNotificationContent({ ...base, reviewerNote: 'See you then' });
    expect(c.emailHtml).toContain('See you then');
  });

  it('omits the note block when note is null', () => {
    const c = buildClaimNotificationContent({ ...base, reviewerNote: null });
    expect(c.emailHtml).not.toMatch(/Manager Note/i);
  });

  it('escapes HTML in interpolated values', () => {
    const c = buildClaimNotificationContent({
      ...base,
      employeeName: '<script>x</script>',
      reviewerNote: 'a & b <b>',
    });
    expect(c.emailHtml).not.toContain('<script>x</script>');
    expect(c.emailHtml).toContain('&lt;script&gt;');
    expect(c.emailHtml).toContain('a &amp; b &lt;b&gt;');
  });
});
