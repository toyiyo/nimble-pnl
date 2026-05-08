import { describe, it, expect } from 'vitest';
import {
  renderTrialEmail,
  type EmailType,
  type Variant,
  type TemplateContext,
} from '../../supabase/functions/_shared/trialEmailTemplates';

const CTX: TemplateContext = {
  firstName: 'Jose',
  unsubscribeUrl: 'https://app.easyshifthq.com/unsubscribe?token=abc.def&list=trial_lifecycle',
  appUrl: 'https://app.easyshifthq.com',
};

const ALL_TYPES: EmailType[] = ['halfway', '3_days', 'tomorrow', 'expired'];
const ALL_VARIANTS: Variant[] = ['activated', 'not_activated'];

describe('renderTrialEmail', () => {
  it.each(ALL_TYPES)('returns subject/html/text for %s × activated', (type) => {
    const out = renderTrialEmail(type, 'activated', CTX);
    expect(out.subject).toBeTruthy();
    expect(out.html).toContain('<');
    expect(out.text.length).toBeGreaterThan(0);
  });

  it.each(ALL_TYPES)('returns subject/html/text for %s × not_activated', (type) => {
    const out = renderTrialEmail(type, 'not_activated', CTX);
    expect(out.subject).toBeTruthy();
    expect(out.html).toContain('<');
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('embeds the recipient first name in the body', () => {
    const out = renderTrialEmail('halfway', 'not_activated', CTX);
    expect(out.html).toContain('Jose');
    expect(out.text).toContain('Jose');
  });

  it('falls back to "there" when firstName is empty', () => {
    const out = renderTrialEmail('halfway', 'not_activated', { ...CTX, firstName: '' });
    expect(out.html.toLowerCase()).toContain('hi there');
    expect(out.text.toLowerCase()).toContain('hi there');
  });

  it('embeds the app URL as a link target', () => {
    const out = renderTrialEmail('3_days', 'activated', CTX);
    expect(out.html).toContain(CTX.appUrl);
    expect(out.text).toContain(CTX.appUrl);
  });

  it('embeds the unsubscribe URL', () => {
    const out = renderTrialEmail('tomorrow', 'not_activated', CTX);
    // HTML escapes `&` to `&amp;`; text keeps the raw URL.
    expect(out.html).toContain(CTX.unsubscribeUrl.replace(/&/g, '&amp;'));
    expect(out.text).toContain(CTX.unsubscribeUrl);
  });

  it('text version contains no HTML tags', () => {
    const out = renderTrialEmail('expired', 'activated', CTX);
    expect(out.text).not.toMatch(/<[^>]+>/);
  });

  it('signs every email with Jose / Founder block', () => {
    for (const type of ALL_TYPES) {
      for (const variant of ALL_VARIANTS) {
        const out = renderTrialEmail(type, variant, CTX);
        expect(out.text).toContain('Jose');
        expect(out.text).toContain('Founder');
        expect(out.text).toContain('EasyShiftHQ');
      }
    }
  });

  it('produces 8 distinct subjects across all (type, variant) combinations', () => {
    const subjects = new Set<string>();
    for (const type of ALL_TYPES) {
      for (const variant of ALL_VARIANTS) {
        subjects.add(renderTrialEmail(type, variant, CTX).subject);
      }
    }
    expect(subjects.size).toBe(8);
  });

  it('not_activated variant mentions connecting a POS', () => {
    const out = renderTrialEmail('halfway', 'not_activated', CTX);
    expect(out.text.toLowerCase()).toMatch(/connect|pos/);
  });

  it('activated variant does not mention "connect a POS"', () => {
    const out = renderTrialEmail('halfway', 'activated', CTX);
    expect(out.text.toLowerCase()).not.toMatch(/connect a pos/);
  });

  it('expired email subject signals trial has ended', () => {
    const out = renderTrialEmail('expired', 'not_activated', CTX);
    expect(out.subject.toLowerCase()).toMatch(/trial|ended|expired|over/);
  });

  it('escapes recipient name in HTML to prevent injection', () => {
    const evil = renderTrialEmail('halfway', 'not_activated', {
      ...CTX,
      firstName: '<script>alert(1)</script>',
    });
    expect(evil.html).not.toContain('<script>alert(1)</script>');
    expect(evil.html).toContain('&lt;script&gt;');
  });
});
