import { describe, it, expect } from 'vitest';
import {
  buildBankReauthNoticeContent,
  type BankReauthNoticeInput,
} from '../../supabase/functions/_shared/bankReauthNoticeContent';

// Noon UTC deliberately — keeps the rendered date stable regardless of the
// machine/CI's local timezone (formatDate has no timeZone override, so it
// renders in local time; a midnight-anchored timestamp could roll to the
// previous/next day depending on where this runs).
const BASE: BankReauthNoticeInput = {
  stage: 'day_1',
  institutionName: 'Chase',
  accountMask: '4242',
  deactivatedAt: '2026-07-10T12:00:00.000Z',
  elapsedDays: 1,
  appUrl: 'https://app.easyshifthq.com',
};

describe('buildBankReauthNoticeContent', () => {
  it('day_1: names the institution, the masked account, and includes a push payload', () => {
    const content = buildBankReauthNoticeContent(BASE);

    expect(content.subject).toContain('Chase');
    expect(content.html).toContain('Chase');
    expect(content.html).toContain('4242');
    expect(content.html).toContain('July 10, 2026');
    expect(content.push).toBeDefined();
    expect(content.push?.url).toBe('/banking');
    expect(content.push?.tag).toBe('bank-reauth-day_1');
  });

  it('day_4: names the cost — elapsed days of missing transactions — and still carries a push payload', () => {
    const content = buildBankReauthNoticeContent({
      ...BASE,
      stage: 'day_4',
      elapsedDays: 4,
    });

    expect(content.html).toContain('4');
    expect(content.push).toBeDefined();
    expect(content.push?.tag).toBe('bank-reauth-day_4');
  });

  it('day_10: consequence tone, no push at all (not an interrupt per design §4.6)', () => {
    const content = buildBankReauthNoticeContent({
      ...BASE,
      stage: 'day_10',
      elapsedDays: 10,
    });

    expect(content.push).toBeUndefined();
    expect(content.html).toContain('Chase');
  });

  it('recovered: a receipt naming what backfilled and through what date', () => {
    const content = buildBankReauthNoticeContent({
      ...BASE,
      stage: 'recovered',
      elapsedDays: undefined,
      dataCurrentThrough: '2026-07-15T12:00:00.000Z',
    });

    expect(content.subject).toContain('Chase');
    expect(content.html).toContain('July 15, 2026');
    expect(content.push).toBeUndefined();
  });

  it('recovered: falls back to "today" when dataCurrentThrough is null', () => {
    const content = buildBankReauthNoticeContent({
      ...BASE,
      stage: 'recovered',
      elapsedDays: undefined,
      dataCurrentThrough: null,
    });

    expect(content.html).toContain('today');
  });

  it('omits the masked-account parenthetical when accountMask is null', () => {
    const content = buildBankReauthNoticeContent({ ...BASE, accountMask: null });

    expect(content.html).not.toContain('(••');
  });

  it('escapes institution names that contain HTML-significant characters', () => {
    const content = buildBankReauthNoticeContent({
      ...BASE,
      institutionName: '<script>Bank</script>',
    });

    expect(content.html).not.toContain('<script>Bank</script>');
    expect(content.html).toContain('&lt;script&gt;');
  });

  it('every stage renders a CTA link to /banking under the caller-supplied appUrl', () => {
    for (const stage of ['day_1', 'day_4', 'day_10', 'recovered'] as const) {
      const content = buildBankReauthNoticeContent({ ...BASE, stage });
      expect(content.html).toContain('https://app.easyshifthq.com/banking');
    }
  });
});
