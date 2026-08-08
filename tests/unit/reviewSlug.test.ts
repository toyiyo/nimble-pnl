import { describe, it, expect } from 'vitest';
import {
  SLUG_PATTERN,
  slugifyPageName,
  randomSlugSuffix,
  withCollisionSuffix,
  isValidSlug,
} from '@/lib/reviews/reviewSlug';

describe('slugifyPageName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyPageName('Table Tents')).toBe('table-tents');
  });

  it('strips punctuation and collapses runs of separators', () => {
    expect(slugifyPageName("Joe's  Bar & Grill!!")).toBe('joes-bar-grill');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyPageName('--front door--')).toBe('front-door');
  });

  it('truncates to 43 characters so a collision suffix still fits', () => {
    const long = 'a'.repeat(80);
    expect(slugifyPageName(long)).toHaveLength(43);
  });

  it('never leaves a trailing hyphen after truncation', () => {
    const awkward = `${'a'.repeat(43)} tail`;
    const slug = slugifyPageName(awkward);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('falls back for names that reduce to fewer than three characters', () => {
    expect(slugifyPageName('!!')).toBe('review-page');
    expect(slugifyPageName('ab')).toBe('review-page');
  });

  it('produces a slug the SQL CHECK accepts', () => {
    for (const name of ['Table Tents', 'Front Door', "Joe's Bar & Grill"]) {
      expect(SLUG_PATTERN.test(slugifyPageName(name))).toBe(true);
    }
  });
});

describe('withCollisionSuffix', () => {
  it('appends four characters after a hyphen', () => {
    const out = withCollisionSuffix('table-tents');
    expect(out).toMatch(/^table-tents-[a-z0-9]{4}$/);
  });

  it('keeps the result inside 48 characters even from a maximal base', () => {
    const out = withCollisionSuffix('a'.repeat(43));
    expect(out.length).toBe(48);
    expect(isValidSlug(out)).toBe(true);
  });

  it('re-truncates a base that is already too long', () => {
    expect(withCollisionSuffix('b'.repeat(60)).length).toBe(48);
  });
});

describe('randomSlugSuffix', () => {
  it('is four lowercase alphanumerics', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{4}$/);
    }
  });
});

describe('isValidSlug', () => {
  it('accepts the shortest and longest legal slugs', () => {
    expect(isValidSlug('abc')).toBe(true);
    expect(isValidSlug('a'.repeat(48))).toBe(true);
  });

  it('rejects slugs that are too short, too long, or edge-hyphenated', () => {
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('a'.repeat(49))).toBe(false);
    expect(isValidSlug('-abc')).toBe(false);
    expect(isValidSlug('abc-')).toBe(false);
    expect(isValidSlug('Abc')).toBe(false);
    expect(isValidSlug('a b')).toBe(false);
  });
});
