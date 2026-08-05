// Slug generation for public review pages.
//
// SLUG_PATTERN mirrors the SQL CHECK in
// supabase/migrations/20260804100100_review_funnel_tables.sql exactly: 3–48
// characters, lowercase alphanumerics and hyphens, never starting or ending
// with a hyphen. If one changes, the other must.

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

const MAX_SLUG_LENGTH = 48;
const SUFFIX_LENGTH = 4;
/** Leaves room for `-` plus a four-character suffix inside MAX_SLUG_LENGTH. */
const MAX_BASE_LENGTH = MAX_SLUG_LENGTH - SUFFIX_LENGTH - 1;
const FALLBACK_SLUG = 'review-page';

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

export function slugifyPageName(name: string): string {
  const base = trimHyphens(
    name
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
  ).slice(0, MAX_BASE_LENGTH);

  const cleaned = trimHyphens(base);
  return cleaned.length >= 3 ? cleaned : FALLBACK_SLUG;
}

export function randomSlugSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  crypto.getRandomValues(bytes);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function withCollisionSuffix(base: string): string {
  const trimmed = trimHyphens(base.slice(0, MAX_BASE_LENGTH));
  const safe = trimmed.length >= 3 ? trimmed : FALLBACK_SLUG;
  return `${safe}-${randomSlugSuffix()}`;
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}
