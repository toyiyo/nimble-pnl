/**
 * Absence guards for the weekly-brief and ops-inbox decommission (task 7).
 *
 * The design deletes two help articles:
 * - src/content/help/financials-and-accounting/weekly-brief-performance-digest.md
 * - src/content/help/financials-and-accounting/ops-inbox-triage-alerts.md
 *
 * Seven other help files link to them or name the features. These
 * guards check that the articles are gone and that no help content
 * points at them.
 */

import { describe, it, expect } from 'vitest';
import { helpArticles } from '@/lib/helpContent';

const RETIRED_SLUGS = ['weekly-brief-performance-digest', 'ops-inbox-triage-alerts'];

describe('help content decommission (weekly brief, ops inbox)', () => {
  it.each(RETIRED_SLUGS)('article "%s" does not exist', (slug) => {
    const match = helpArticles.find((a) => a.slug === slug);
    expect(match).toBeUndefined();
  });

  it('no related[] entry points at a retired slug', () => {
    const broken: string[] = [];
    for (const a of helpArticles) {
      for (const r of a.related) {
        if (RETIRED_SLUGS.includes(r)) broken.push(`${a.slug} -> ${r}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('no article body links to a retired slug', () => {
    const broken: string[] = [];
    for (const a of helpArticles) {
      for (const slug of RETIRED_SLUGS) {
        if (a.body.includes(`/help/${slug}`)) broken.push(`${a.slug} -> /help/${slug}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('no article names the retired features', () => {
    const broken: string[] = [];
    const namePattern = /weekly\s+brief|ops\s+inbox/i;
    for (const a of helpArticles) {
      const text = [a.title, a.summary, a.keywords.join(' '), a.body].join(' ');
      if (namePattern.test(text)) broken.push(a.slug);
    }
    expect(broken).toEqual([]);
  });
});
