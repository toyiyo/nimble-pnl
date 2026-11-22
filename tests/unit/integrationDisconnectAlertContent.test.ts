import { describe, it, expect } from 'vitest';
import {
  buildIntegrationDisconnectEmail,
  buildIntegrationDisconnectSlackPayload,
  escapeSlackText,
} from '../../supabase/functions/_shared/integrationDisconnectAlertContent';

const base = {
  integration: 'toast',
  restaurantId: 'r1',
  restaurantName: 'Taco Place',
  restaurantTimezone: 'America/New_York',
  actorName: 'Ana Lopez',
  actorEmail: 'ana@example.com',
  occurredAt: '2026-11-21T03:30:00Z',
  reason: 'switching_pos',
  reasonText: 'Moving to another system',
  appUrl: 'https://app.example.com/',
};

describe('buildIntegrationDisconnectEmail', () => {
  it('puts the integration and restaurant in the subject', () => {
    const { subject } = buildIntegrationDisconnectEmail(base);
    expect(subject).toBe('Toast was disconnected from Taco Place');
  });

  it('shows actor, reason label, reason text, and a Reconnect link', () => {
    const { html } = buildIntegrationDisconnectEmail(base);
    expect(html).toContain('Ana Lopez');
    expect(html).toContain('I am switching to a different POS');
    expect(html).toContain('Moving to another system');
    expect(html).toContain('Reconnect');
    expect(html).toContain('https://app.example.com/integrations');
  });

  it('formats the time in the restaurant time zone', () => {
    const { html } = buildIntegrationDisconnectEmail(base);
    expect(html).toContain('Nov 20');
  });

  it('escapes HTML in the reason text', () => {
    const { html } = buildIntegrationDisconnectEmail({ ...base, reasonText: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
  });

  it('omits the reason lines when there is no reason', () => {
    const { html } = buildIntegrationDisconnectEmail({ ...base, reason: null, reasonText: null });
    expect(html).not.toContain('I am switching');
  });

  it('uses A team member when the actor is missing', () => {
    const { html } = buildIntegrationDisconnectEmail({ ...base, actorName: null });
    expect(html).toContain('A team member');
  });
});

describe('escapeSlackText', () => {
  it('escapes ampersand, less-than, and greater-than', () => {
    expect(escapeSlackText('<!channel> & <b>')).toBe('&lt;!channel&gt; &amp; &lt;b&gt;');
  });
});

describe('buildIntegrationDisconnectSlackPayload', () => {
  it('sets link_names false and uses plain_text for free text', () => {
    const p = buildIntegrationDisconnectSlackPayload({ ...base, reasonText: '<!channel>' });
    expect(p.link_names).toBe(false);
    const json = JSON.stringify(p.blocks);
    expect(json).toContain('plain_text');
    expect(p.text).not.toContain('<!channel>');
  });

  it('caps the reason text at 500 characters', () => {
    const p = buildIntegrationDisconnectSlackPayload({ ...base, reasonText: 'a'.repeat(900) });
    expect(JSON.stringify(p.blocks)).not.toContain('a'.repeat(501));
  });

  it('escapes the restaurant name in the mrkdwn fallback text', () => {
    const p = buildIntegrationDisconnectSlackPayload({ ...base, restaurantName: '<script>' });
    expect(p.text).toContain('&lt;script&gt;');
  });
});
