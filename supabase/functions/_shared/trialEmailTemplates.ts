// Trial-expiry email templates — 4 types × 2 variants.
//
// Pure module. No Deno-specific imports so it runs in Vitest unit tests as
// well as inside the edge function. The voice is operator-to-operator,
// signed by Jose. Each variant tunes around whether the restaurant has
// connected a POS (the activation milestone) — `not_activated` pushes
// activation, `activated` pushes subscribing.

export type EmailType = 'halfway' | '3_days' | 'tomorrow' | 'expired';
export type Variant = 'activated' | 'not_activated';

export interface TemplateContext {
  firstName: string;
  unsubscribeUrl: string;
  appUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SIG_TEXT =
  '— Jose\nFounder, EasyShiftHQ\nOperator running a Cold Stone / Wetzel\'s co-brand in San Antonio.';

const SIG_HTML = `<p style="margin:24px 0 0 0;color:#57534e;font-size:14px;line-height:1.5">
  — Jose<br>
  Founder, EasyShiftHQ<br>
  Operator running a Cold Stone / Wetzel's co-brand in San Antonio.
</p>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greeting(firstName: string): string {
  const name = firstName.trim();
  return name ? `Hi ${name},` : 'Hi there,';
}

interface Copy {
  subject: string;
  intro: string;
  body: string[];
  cta: string;
}

function copyFor(type: EmailType, variant: Variant): Copy {
  if (type === 'halfway' && variant === 'not_activated') {
    return {
      subject: 'You\'re halfway through your EasyShiftHQ trial — let\'s connect your POS',
      intro: 'You started your trial 7 days ago — that\'s halfway through.',
      body: [
        'I noticed you haven\'t connected a POS yet. Without one, you\'re missing the part of EasyShiftHQ that actually moves the needle: real-time sales pulled into a P&L you can read in 30 seconds.',
        'It takes about 2 minutes to connect (Square, Toast, Clover, or Shift4). Want me to walk you through it? Just reply to this email.',
      ],
      cta: 'Connect your POS',
    };
  }
  if (type === 'halfway' && variant === 'activated') {
    return {
      subject: 'You\'re halfway through your EasyShiftHQ trial',
      intro: 'You\'re 7 days into your trial and your POS is connected — nice.',
      body: [
        'You\'re seeing real numbers now. The next things most operators turn on are payroll sync and inventory tracking — both compound the value of the data you\'re already pulling in.',
        'If you\'ve got questions about which features are worth your time, reply directly. I read every one.',
      ],
      cta: 'Open your dashboard',
    };
  }
  if (type === '3_days' && variant === 'not_activated') {
    return {
      subject: '3 days left — your EasyShiftHQ trial isn\'t pulling in real numbers yet',
      intro: 'Your trial ends in 3 days, and your account still doesn\'t have a POS connected.',
      body: [
        'I\'m not going to push you to subscribe — without a POS, EasyShiftHQ won\'t do its job for you, and you\'ll feel that.',
        'If something\'s blocking the connection (a credential you can\'t find, a question about which POS to pick, anything else), reply to this email. We\'ll fix it together before the trial runs out.',
      ],
      cta: 'Connect your POS',
    };
  }
  if (type === '3_days' && variant === 'activated') {
    return {
      subject: '3 days left — pick a plan to keep your EasyShiftHQ dashboard live',
      intro: 'Your trial ends in 3 days. Your POS is connected and your numbers are flowing.',
      body: [
        'If EasyShiftHQ has earned a spot in your week, this is the moment to lock it in. Pricing is honest, no card was needed to try, and there\'s no annual contract — month to month.',
        'If something\'s missing or unclear, reply to this email before you decide. I\'d rather hear it now.',
      ],
      cta: 'Pick a plan',
    };
  }
  if (type === 'tomorrow' && variant === 'not_activated') {
    return {
      subject: 'Your EasyShiftHQ trial ends tomorrow — want a 1-week extension?',
      intro: 'Tomorrow is the last day of your trial.',
      body: [
        'You haven\'t connected a POS, so I want to be honest: subscribing right now without one wouldn\'t be worth your money.',
        'If you want a 1-week extension to get a POS connected, reply with the word "extend" and I\'ll add it to your account. No tricks.',
      ],
      cta: 'Connect your POS',
    };
  }
  if (type === 'tomorrow' && variant === 'activated') {
    return {
      subject: 'Your EasyShiftHQ trial ends tomorrow — last chance to subscribe',
      intro: 'Tomorrow is your last day on the trial.',
      body: [
        'If you want to keep the dashboard open and the numbers flowing, pick a plan today. After tomorrow the account locks until you subscribe.',
        'If anything is on the fence, reply — I\'ll answer fast.',
      ],
      cta: 'Pick a plan',
    };
  }
  if (type === 'expired' && variant === 'not_activated') {
    return {
      subject: 'Your EasyShiftHQ trial just ended — want me to restart it?',
      intro: 'Your 14-day trial ended yesterday.',
      body: [
        'I noticed you never connected a POS, so the trial probably didn\'t show you the value EasyShiftHQ is supposed to bring. That\'s on me to fix.',
        'If you want to give it another shot, reply to this email and I\'ll reactivate the trial after we get a POS hooked up. No subscription required to try again.',
      ],
      cta: 'Restart your trial',
    };
  }
  // expired × activated
  return {
    subject: 'Your EasyShiftHQ trial just ended — pick a plan to unlock your data',
    intro: 'Your 14-day trial ended yesterday.',
    body: [
      'Your POS is still connected and the data is still there — just paywalled now. Subscribe and you pick up exactly where you left off.',
      'If you\'re holding off on a question (pricing, features, plan tier), reply to this email and I\'ll get back to you the same day.',
    ],
    cta: 'Pick a plan and unlock',
  };
}

function htmlBody(c: Copy, ctx: TemplateContext): string {
  const safeFirst = escapeHtml(ctx.firstName.trim());
  const greetHtml = safeFirst ? `Hi ${safeFirst},` : 'Hi there,';
  const paragraphs = c.body
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;color:#1c1917;font-size:16px;line-height:1.6">${escapeHtml(
          p
        )}</p>`
    )
    .join('\n  ');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#fafaf9;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border:1px solid #e7e5e4;border-radius:8px">
  <p style="margin:0 0 16px 0;color:#1c1917;font-size:16px;line-height:1.6">${greetHtml}</p>
  <p style="margin:0 0 16px 0;color:#1c1917;font-size:16px;line-height:1.6">${escapeHtml(
    c.intro
  )}</p>
  ${paragraphs}
  <p style="margin:24px 0">
    <a href="${escapeHtml(ctx.appUrl)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;font-weight:600">${escapeHtml(
      c.cta
    )}</a>
  </p>
  ${SIG_HTML}
  <hr style="border:none;border-top:1px solid #e7e5e4;margin:32px 0 16px 0">
  <p style="margin:0;color:#a8a29e;font-size:12px;line-height:1.5">
    You're getting this because you started a free trial of EasyShiftHQ.
    <a href="${escapeHtml(
      ctx.unsubscribeUrl
    )}" style="color:#a8a29e;text-decoration:underline">Unsubscribe from trial emails</a>.
  </p>
</div>
</body>
</html>`;
}

function textBody(c: Copy, ctx: TemplateContext): string {
  return [
    greeting(ctx.firstName),
    '',
    c.intro,
    '',
    ...c.body.flatMap((p) => [p, '']),
    `${c.cta}: ${ctx.appUrl}`,
    '',
    SIG_TEXT,
    '',
    '---',
    `Unsubscribe from trial emails: ${ctx.unsubscribeUrl}`,
  ].join('\n');
}

export function renderTrialEmail(
  type: EmailType,
  variant: Variant,
  ctx: TemplateContext
): RenderedEmail {
  const copy = copyFor(type, variant);
  return {
    subject: copy.subject,
    html: htmlBody(copy, ctx),
    text: textBody(copy, ctx),
  };
}
