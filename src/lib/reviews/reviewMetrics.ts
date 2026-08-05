// Aggregation for the Feedback tab header.
//
// Every rating counts toward the average and the total; only commented rows
// appear in the inbox list. A page collecting 300 taps and 50 comments has an
// inbox of 50 rows, and an average built from all 300.
//
// The aggregation itself now runs server-side (see the `review_page_stats`
// and `review_response_metrics` SQL functions added by
// 20260804110000_review_response_aggregates.sql, consumed by
// useReviewPages.ts / useReviewResponses.ts) rather than by folding query
// results through a client-side helper here. This file only keeps the shared
// result shape both hooks return.

export interface ReviewMetrics {
  /** null when there are no responses at all — not 0, which would read as one-star. */
  averageRating: number | null;
  totalRatings: number;
  commentCount: number;
  unreadCount: number;
}
