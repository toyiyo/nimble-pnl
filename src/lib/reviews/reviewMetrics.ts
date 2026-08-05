// Aggregation for the Feedback tab header.
//
// Every rating counts toward the average and the total; only commented rows
// appear in the inbox list. A page collecting 300 taps and 50 comments has an
// inbox of 50 rows, and an average built from all 300.

export interface ReviewResponseSummary {
  rating: number;
  hasComment: boolean;
  status: 'new' | 'in_progress' | 'resolved';
}

export interface ReviewMetrics {
  /** null when there are no responses at all — not 0, which would read as one-star. */
  averageRating: number | null;
  totalRatings: number;
  commentCount: number;
  unreadCount: number;
}

export function summarizeResponses(rows: readonly ReviewResponseSummary[]): ReviewMetrics {
  if (rows.length === 0) {
    return { averageRating: null, totalRatings: 0, commentCount: 0, unreadCount: 0 };
  }

  let ratingSum = 0;
  let commentCount = 0;
  let unreadCount = 0;

  for (const row of rows) {
    ratingSum += row.rating;
    if (row.hasComment) commentCount += 1;
    if (row.status === 'new') unreadCount += 1;
  }

  return {
    averageRating: Math.round((ratingSum / rows.length) * 10) / 10,
    totalRatings: rows.length,
    commentCount,
    unreadCount,
  };
}
