import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://stub.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  },
}));

import { initials, logoPublicUrl } from '@/lib/reviews/reviewBranding';

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Blue Fin Sushi')).toBe('BF');
  });

  it('takes one letter from a single word', () => {
    expect(initials('Nobu')).toBe('N');
  });

  it('returns an empty string for an empty name', () => {
    expect(initials('')).toBe('');
  });

  it('returns an empty string for whitespace only', () => {
    expect(initials('   ')).toBe('');
  });

  it('uppercases accented letters', () => {
    expect(initials('Café Ñoño')).toBe('CÑ');
  });

  it('collapses runs of whitespace', () => {
    expect(initials('  The   Grill  ')).toBe('TG');
  });
});

describe('logoPublicUrl', () => {
  it('returns null for a null path', () => {
    expect(logoPublicUrl(null)).toBeNull();
  });

  it('returns null for an empty path', () => {
    expect(logoPublicUrl('')).toBeNull();
  });

  it('builds a public URL from the review-page-logos bucket', () => {
    expect(logoPublicUrl('rest-1/page-2/abc.png')).toBe(
      'https://stub.supabase.co/storage/v1/object/public/review-page-logos/rest-1/page-2/abc.png'
    );
  });
});
