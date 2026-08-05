import { describe, it, expect } from 'vitest';
import { summarizeResponses, type ReviewResponseSummary } from '@/lib/reviews/reviewMetrics';

function row(
  rating: number,
  hasComment: boolean,
  status: ReviewResponseSummary['status'] = 'new'
): ReviewResponseSummary {
  return { rating, hasComment, status };
}

describe('summarizeResponses', () => {
  it('returns a null average for no responses', () => {
    expect(summarizeResponses([])).toEqual({
      averageRating: null,
      totalRatings: 0,
      commentCount: 0,
      unreadCount: 0,
    });
  });

  it('averages every rating, including those with no comment', () => {
    const result = summarizeResponses([row(5, false), row(5, false), row(2, true)]);
    expect(result.totalRatings).toBe(3);
    expect(result.averageRating).toBeCloseTo(4);
  });

  it('counts only commented rows as comments', () => {
    expect(summarizeResponses([row(5, false), row(2, true), row(1, true)]).commentCount).toBe(2);
  });

  it('counts only new rows as unread', () => {
    const rows = [row(2, true, 'new'), row(3, true, 'in_progress'), row(1, true, 'resolved')];
    expect(summarizeResponses(rows).unreadCount).toBe(1);
  });

  it('rounds the average to one decimal place', () => {
    expect(summarizeResponses([row(4, false), row(5, false), row(5, false)]).averageRating).toBe(4.7);
  });
});
