import { describe, it, expect } from 'vitest';
// CommonJS import — feedback-log.js is plain Node, no TS
import { sanitize } from '../../dev-tools/feedback-log.js';

describe('feedback-log: sanitize', () => {
  it('strips email addresses', () => {
    expect(sanitize('contact monica@rushbowls.com about this')).toBe(
      'contact <redacted-email> about this',
    );
  });

  it('strips UUIDs', () => {
    expect(sanitize('user 4bb07d19-bb65-4661-89c6-bb537b0fa1de failed')).toBe(
      'user <redacted-uuid> failed',
    );
  });

  it('strips bearer tokens and JWT-shaped strings', () => {
    expect(sanitize('Authorization: Bearer abc.def.ghi')).toContain('<redacted-token>');
    expect(sanitize('token eyJhbGciOi.eyJzdWIiOi.signaturepart')).toContain(
      '<redacted-token>',
    );
  });

  it('redacts restaurant_id query/url segments', () => {
    expect(sanitize('restaurant_id=ae87f51e-e2c0-44f4-b6bb-3953d5bbdbff')).toBe(
      'restaurant_id=<redacted>',
    );
  });

  it('truncates output longer than 2000 chars with ellipsis marker', () => {
    const input = 'a'.repeat(5000);
    const out = sanitize(input);
    expect(out.length).toBeLessThanOrEqual(2000 + '… [truncated]'.length);
    expect(out.endsWith('… [truncated]')).toBe(true);
  });

  it('passes through clean text unchanged', () => {
    expect(sanitize('Scroll does not work on /pos-sales')).toBe(
      'Scroll does not work on /pos-sales',
    );
  });
});
