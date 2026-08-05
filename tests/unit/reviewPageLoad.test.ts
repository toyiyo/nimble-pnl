import { describe, it, expect } from 'vitest';
import { classifyReviewPageResponse } from '@/lib/reviews/reviewPageLoad';

const VALID = {
  restaurant_name: 'Test Diner',
  headline: 'How was everything?',
  subheadline: null,
  logo_url: null,
  threshold: 4,
};

describe('classifyReviewPageResponse', () => {
  it('classifies a resolved error as error, whatever the data says', () => {
    expect(classifyReviewPageResponse(VALID, { message: 'boom' })).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse(null, { message: 'boom' })).toEqual({ kind: 'error' });
  });

  it('classifies a missing or non-object payload as error', () => {
    expect(classifyReviewPageResponse(null, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse(undefined, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse('nope', null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse([VALID], null)).toEqual({ kind: 'error' });
  });

  it('classifies the paused payload as inactive', () => {
    expect(classifyReviewPageResponse({ inactive: true }, null)).toEqual({ kind: 'inactive' });
  });

  it('classifies a valid payload as ready and carries it through', () => {
    expect(classifyReviewPageResponse(VALID, null)).toEqual({ kind: 'ready', page: VALID });
  });

  it('accepts an empty restaurant_name', () => {
    // The function emits `?? ''` when the restaurant join is null
    // (review-public/index.ts:141). Unreachable under the current NOT NULL
    // schema, but a validator that rejected it would render a live page as an
    // error — the exact failure this whole change exists to prevent.
    const page = { ...VALID, restaurant_name: '' };
    expect(classifyReviewPageResponse(page, null)).toEqual({ kind: 'ready', page });
  });

  it('accepts a populated subheadline and logo_url', () => {
    const page = { ...VALID, subheadline: 'It takes 10 seconds', logo_url: 'https://x/y.png' };
    expect(classifyReviewPageResponse(page, null)).toEqual({ kind: 'ready', page });
  });

  it('classifies a payload the page cannot render as error', () => {
    expect(classifyReviewPageResponse({ ...VALID, headline: undefined }, null)).toEqual({
      kind: 'error',
    });
    expect(classifyReviewPageResponse({ ...VALID, restaurant_name: 7 }, null)).toEqual({
      kind: 'error',
    });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 'four' }, null)).toEqual({
      kind: 'error',
    });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 2.5 }, null)).toEqual({
      kind: 'error',
    });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 0 }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 6 }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, subheadline: 12 }, null)).toEqual({
      kind: 'error',
    });
  });

  it('ignores inactive when it is not exactly true', () => {
    // A payload carrying `inactive: false` alongside a real page is still a
    // page; a payload carrying only `inactive: false` is unreadable.
    expect(classifyReviewPageResponse({ ...VALID, inactive: false }, null)).toEqual({
      kind: 'ready',
      page: { ...VALID, inactive: false },
    });
    expect(classifyReviewPageResponse({ inactive: false }, null)).toEqual({ kind: 'error' });
  });
});
