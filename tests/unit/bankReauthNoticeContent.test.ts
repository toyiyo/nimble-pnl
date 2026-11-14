import { describe, it, expect } from 'vitest';
import {
  buildBankReauthNoticeContent,
  cleanRestaurantName,
  type BankReauthNoticeInput,
} from '../../supabase/functions/_shared/bankReauthNoticeContent';
import { SELECT_RESTAURANT_PARAM } from '../../src/lib/restaurantDeepLink';

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
  restaurantId: 'rest-1',
};

describe('buildBankReauthNoticeContent', () => {
  it('day_1: names the institution, the masked account, and includes a push payload', () => {
    const content = buildBankReauthNoticeContent(BASE);

    expect(content.subject).toContain('Chase');
    expect(content.html).toContain('Chase');
    expect(content.html).toContain('4242');
    expect(content.html).toContain('July 10, 2026');
    expect(content.push).toBeDefined();
    expect(content.push?.url).toBe('/banking?select_restaurant=rest-1');
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

describe('restaurant name and link', () => {
  const NAMED = { ...BASE, restaurantName: 'Russos Pizzeria' };
  const stages = [
    { stage: 'day_1', elapsedDays: 1 },
    { stage: 'day_4', elapsedDays: 4 },
    { stage: 'day_10', elapsedDays: 10 },
    { stage: 'recovered', elapsedDays: undefined },
  ] as const;

  for (const s of stages) {
    it(`${s.stage}: shows the name in subject and message`, () => {
      const c = buildBankReauthNoticeContent({ ...NAMED, ...s });
      expect(c.subject.startsWith('Russos Pizzeria: ')).toBe(true);
      expect(c.html).toContain('Chase (••4242) at Russos Pizzeria');
      if (c.push) expect(c.push.title.startsWith('Russos Pizzeria: ')).toBe(true);
    });
  }

  it('keeps the old copy with no name or a blank name', () => {
    const none = buildBankReauthNoticeContent(BASE);
    const nul = buildBankReauthNoticeContent({ ...BASE, restaurantName: null });
    const blank = buildBankReauthNoticeContent({ ...BASE, restaurantName: '  \r\n ' });
    expect(none.subject).toBe('Reconnect Chase — bank sync paused');
    expect(none.push?.title).toBe('Chase needs reconnecting');
    expect(none.html).not.toContain(' at ');
    expect(nul.subject).toBe(none.subject);
    expect(blank.subject).toBe(none.subject);
    expect(blank.html).toBe(none.html);
  });

  it('uses the same path for push and email, with the id encoded', () => {
    const c = buildBankReauthNoticeContent({ ...NAMED, restaurantId: 'a b&c' });
    expect(c.push?.url).toBe('/banking?select_restaurant=a%20b%26c');
    expect(c.html).toContain('https://app.easyshifthq.com/banking?select_restaurant=a%20b%26c');
    const r = buildBankReauthNoticeContent({ ...NAMED, stage: 'recovered', elapsedDays: undefined });
    expect(r.html).toContain('/banking?select_restaurant=rest-1');
  });

  it('cleanRestaurantName: CR/LF, long name, blank', () => {
    expect(cleanRestaurantName('Bad\r\nName\t Inc')).toBe('Bad Name Inc');
    expect(cleanRestaurantName('   ')).toBeNull();
    expect(cleanRestaurantName(null)).toBeNull();
    expect(cleanRestaurantName(undefined)).toBeNull();
    const long = cleanRestaurantName('x'.repeat(100));
    expect(long).toBe('x'.repeat(60) + '…');
    expect(cleanRestaurantName('x'.repeat(60))).toBe('x'.repeat(60));
  });
  it('cleanRestaurantName: delete bidi controls, keep ZWNJ and ZWJ', () => {
    expect(cleanRestaurantName('A\u202eB\u200bC\u200eD\u061cE\ufeffF')).toBe('ABCDEF');
    expect(cleanRestaurantName('\u{1F468}\u200d\u{1F373}')).toBe('\u{1F468}\u200d\u{1F373}');
    expect(cleanRestaurantName('a\u200cb')).toBe('a\u200cb');
  });

  it('use the same select_restaurant key as the frontend', () => {
    const c = buildBankReauthNoticeContent({
      stage: 'day_1',
      institutionName: 'Chase',
      restaurantId: 'rest-1',
      accountMask: null,
      deactivatedAt: '2026-11-01T12:00:00Z',
      elapsedDays: 1,
      appUrl: 'https://app.easyshifthq.com',
    });
    expect(c.html).toContain(`/banking?${SELECT_RESTAURANT_PARAM}=rest-1`);
  });
});
