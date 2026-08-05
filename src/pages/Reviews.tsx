import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ChevronLeft, Plus, Star } from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useReviewPages, type ReviewPageWithStats } from '@/hooks/useReviewPages';
import { useReviewResponses, type ReviewResponse, type ReviewResponseStatus } from '@/hooks/useReviewResponses';
import { ReviewPageBuilder } from '@/components/reviews/ReviewPageBuilder';
import { ReviewFeedbackDetail } from '@/components/reviews/ReviewFeedbackDetail';
import { formatRelativeTime } from '@/lib/reviews/relativeTime';

type Tab = 'pages' | 'feedback';

export default function Reviews() {
  const { selectedRestaurant } = useRestaurantContext();
  const { hasCapability } = usePermissions();
  const restaurantId = selectedRestaurant?.restaurant_id;
  const canManage = hasCapability('manage:reviews');

  const [tab, setTab] = useState<Tab>('pages');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
          <Star className="h-5 w-5 text-foreground" />
        </div>
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">Reviews</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            QR pages that send happy guests to Google and everyone else to you.
          </p>
        </div>
      </div>

      <div className="mt-6 border-b border-border/40">
        {(
          [
            ['pages', 'Pages'],
            ['feedback', 'Feedback'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
              tab === key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {tab === key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'pages' ? (
          <PagesTab restaurantId={restaurantId} canManage={canManage} />
        ) : (
          <FeedbackTab restaurantId={restaurantId} canManage={canManage} />
        )}
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<ReviewResponseStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function FeedbackTab({ restaurantId, canManage }: { restaurantId?: string; canManage: boolean }) {
  const { responses, metrics, isLoading, error, updateStatus, fetchContact } =
    useReviewResponses(restaurantId);
  const { pages } = useReviewPages(restaurantId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ratings without a comment are a number, not a message. They count toward
  // the header metrics and stay out of the list — an inbox of 300 silent
  // five-star taps is an inbox nobody opens.
  const commented = responses.filter((row) => Boolean(row.comment));
  const selected = commented.find((row) => row.id === selectedId) ?? null;
  const pageNames = new Map(pages.map((page) => [page.id, page.name]));
  const nowMs = Date.now();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border/40 p-6">
        <p className="text-[14px] text-foreground">We couldn&apos;t load your feedback.</p>
        <p className="text-[13px] text-muted-foreground mt-1">Refresh and try again.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Average', metrics.averageRating === null ? '—' : `${metrics.averageRating} ★`],
          ['Ratings', String(metrics.totalRatings)],
          ['Comments', String(metrics.commentCount)],
          ['Unread', String(metrics.unreadCount)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border/40 bg-muted/30 p-4">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            <p className="mt-1 text-[17px] font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {commented.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border/40 p-10 text-center">
          <h2 className="text-[15px] font-semibold text-foreground">No written feedback yet</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Guests who rate below your threshold get the private form. Their notes land here.
          </p>
        </div>
      ) : (
        <div className="mt-6 md:grid md:grid-cols-[340px_1fr] md:gap-6">
          <div className={selected ? 'hidden md:block' : 'block'}>
            <div className="space-y-2">
              {commented.map((row) => (
                <FeedbackRow
                  key={row.id}
                  response={row}
                  pageName={pageNames.get(row.review_page_id) ?? 'Deleted page'}
                  nowMs={nowMs}
                  selected={row.id === selectedId}
                  onSelect={() => setSelectedId(row.id)}
                />
              ))}
            </div>
          </div>

          <div className={selected ? 'block' : 'hidden md:block'}>
            {selected ? (
              <ReviewFeedbackDetail
                response={selected}
                pageName={pageNames.get(selected.review_page_id) ?? 'Deleted page'}
                canManage={canManage}
                fetchContact={fetchContact}
                onStatusChange={(status) => updateStatus({ id: selected.id, status })}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <p className="hidden md:block text-[13px] text-muted-foreground">
                Pick a note to read it.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackRow({
  response,
  pageName,
  nowMs,
  selected,
  onSelect,
}: {
  response: ReviewResponse;
  pageName: string;
  nowMs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left p-4 rounded-xl border bg-background transition-colors ${
        selected ? 'border-border' : 'border-border/40 hover:border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-foreground" aria-label={`${response.rating} out of 5 stars`}>
          {'★'.repeat(response.rating)}
          <span className="text-muted-foreground/40">{'☆'.repeat(5 - response.rating)}</span>
        </span>
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
          {STATUS_LABELS[response.status]}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground truncate">
        {pageName} · {formatRelativeTime(response.commented_at ?? response.submitted_at, nowMs)}
      </p>
      <p className="mt-2 text-[13px] text-foreground line-clamp-2">{response.comment}</p>
    </button>
  );
}

function PagesTab({ restaurantId, canManage }: { restaurantId?: string; canManage: boolean }) {
  const { pages, isLoading, error } = useReviewPages(restaurantId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = pages.find((page) => page.id === selectedId) ?? null;
  // Below md the list and the detail are the same column: the list fills the
  // viewport, tapping a card replaces it, and a back control returns. A
  // two-pane layout squeezed into 375px gives neither pane enough room.
  const showDetail = creating || selected !== null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border/40 p-6">
        <p className="text-[14px] text-foreground">We couldn&apos;t load your pages.</p>
        <p className="text-[13px] text-muted-foreground mt-1">Refresh and try again.</p>
      </div>
    );
  }

  if (pages.length === 0 && !creating) {
    return (
      <div className="rounded-xl border border-border/40 p-10 text-center">
        <div className="mx-auto h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
          <Star className="h-5 w-5 text-foreground" />
        </div>
        <h2 className="mt-4 text-[15px] font-semibold text-foreground">No review pages yet</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Make one, print the QR, and put it where guests pay.
        </p>
        {canManage && (
          <Button
            onClick={() => setCreating(true)}
            className="mt-5 h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            <Plus className="mr-2 h-4 w-4" />
            New page
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="md:grid md:grid-cols-[320px_1fr] md:gap-6">
      <div className={showDetail ? 'hidden md:block' : 'block'}>
        {canManage && (
          <Button
            variant="outline"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
            className="mb-3 h-9 w-full rounded-lg text-[13px] font-medium"
          >
            <Plus className="mr-2 h-4 w-4" />
            New page
          </Button>
        )}

        <div className="space-y-2">
          {pages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              selected={page.id === selectedId}
              onSelect={() => {
                setCreating(false);
                setSelectedId(page.id);
              }}
            />
          ))}
        </div>
      </div>

      <div className={showDetail ? 'block' : 'hidden md:block'}>
        {showDetail && (
          <Button
            variant="ghost"
            onClick={() => {
              setCreating(false);
              setSelectedId(null);
            }}
            className="mb-3 h-9 px-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground md:hidden"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            All pages
          </Button>
        )}

        {restaurantId && showDetail ? (
          <ReviewPageBuilder
            page={creating ? null : selected}
            restaurantId={restaurantId}
            onCreated={(id) => {
              setCreating(false);
              setSelectedId(id);
            }}
          />
        ) : (
          <p className="hidden md:block text-[13px] text-muted-foreground">
            Pick a page to edit it.
          </p>
        )}
      </div>
    </div>
  );
}

function PageCard({
  page,
  selected,
  onSelect,
}: {
  page: ReviewPageWithStats;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left p-4 rounded-xl border bg-background transition-colors ${
        selected ? 'border-border' : 'border-border/40 hover:border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-foreground truncate">{page.name}</span>
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded-md ${
            page.is_active ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {page.is_active ? 'Live' : 'Paused'}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground truncate">/r/{page.slug}</p>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {page.ratingCount === 0
          ? 'No ratings yet'
          : `${page.averageRating} ★ · ${page.ratingCount} ratings · ${page.commentCount} comments`}
      </p>
    </button>
  );
}
