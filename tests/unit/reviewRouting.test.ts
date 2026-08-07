import { describe, it, expect } from 'vitest';
import { routeRating } from '../../supabase/functions/_shared/reviewRouting';

describe('routeRating', () => {
  it('routes a rating at or above the threshold to the destination', () => {
    expect(routeRating(4, 4, 'https://g.page/r/abc')).toEqual({
      routedTo: 'destination',
      destinationUrl: 'https://g.page/r/abc',
    });
    expect(routeRating(5, 4, 'https://g.page/r/abc').routedTo).toBe('destination');
  });

  it('routes a rating below the threshold to feedback and withholds the URL', () => {
    expect(routeRating(3, 4, 'https://g.page/r/abc')).toEqual({
      routedTo: 'feedback',
      destinationUrl: null,
    });
  });

  it('routes everything to feedback when the page has no destination', () => {
    expect(routeRating(5, 4, null)).toEqual({
      routedTo: 'feedback',
      destinationUrl: null,
    });
  });

  it('honours a threshold of 1 (every rating is a promoter)', () => {
    expect(routeRating(1, 1, 'https://g.page/r/abc').routedTo).toBe('destination');
  });

  it('honours a threshold of 5 (only a perfect rating is a promoter)', () => {
    expect(routeRating(4, 5, 'https://g.page/r/abc').routedTo).toBe('feedback');
    expect(routeRating(5, 5, 'https://g.page/r/abc').routedTo).toBe('destination');
  });

  it('treats an out-of-range rating as feedback rather than throwing', () => {
    expect(routeRating(0, 4, 'https://g.page/r/abc').routedTo).toBe('feedback');
    expect(routeRating(9, 4, 'https://g.page/r/abc').routedTo).toBe('feedback');
  });
});
