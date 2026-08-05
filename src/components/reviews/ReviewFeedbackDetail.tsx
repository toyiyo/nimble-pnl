import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ChevronLeft } from 'lucide-react';

import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { StarDisplay } from '@/components/reviews/StarDisplay';
import type {
  ReviewResponse,
  ReviewResponseContact,
  ReviewResponseStatus,
} from '@/hooks/useReviewResponses';

interface ReviewFeedbackDetailProps {
  response: ReviewResponse;
  pageName: string;
  canManage: boolean;
  fetchContact: (id: string) => Promise<ReviewResponseContact | null>;
  onStatusChange: (status: ReviewResponseStatus) => void;
  onBack: () => void;
}

export function ReviewFeedbackDetail({
  response,
  pageName,
  canManage,
  fetchContact,
  onStatusChange,
  onBack,
}: ReviewFeedbackDetailProps) {
  const { formatInstant, tzAbbrev } = useRestaurantClock();
  const [contact, setContact] = useState<ReviewResponseContact | null>(null);

  useEffect(() => {
    // The contact row is a separate fetch on a separate table, so a viewer
    // without manage:reviews simply gets nothing back — RLS is row-level and
    // could not have hidden these columns inside review_responses.
    if (!canManage || !response.contact_consent) {
      setContact(null);
      return;
    }
    let cancelled = false;
    fetchContact(response.id).then((row) => {
      if (!cancelled) setContact(row);
    });
    return () => {
      cancelled = true;
    };
  }, [canManage, fetchContact, response.contact_consent, response.id]);

  return (
    <div className="rounded-xl border border-border/40 bg-background p-5">
      <Button
        variant="ghost"
        onClick={onBack}
        className="mb-3 h-9 px-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground md:hidden"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        All feedback
      </Button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <StarDisplay rating={response.rating} as="p" className="text-[20px] leading-none text-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">
            {pageName} · {formatInstant(response.commented_at ?? response.submitted_at, 'MMM d, yyyy h:mm a')}{' '}
            {tzAbbrev}
          </p>
        </div>

        {canManage && (
          <Select
            value={response.status}
            onValueChange={(value) => onStatusChange(value as ReviewResponseStatus)}
          >
            <SelectTrigger
              aria-label="Feedback status"
              className="h-9 w-[150px] text-[13px] bg-muted/30 border-border/40 rounded-lg"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <p className="mt-5 text-[14px] text-foreground whitespace-pre-wrap">{response.comment}</p>

      {canManage && (
        <div className="mt-6 rounded-xl border border-border/40 bg-muted/30 p-4">
          <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Contact
          </h3>
          {contact?.contact_email || contact?.contact_name ? (
            <div className="mt-2 space-y-1">
              <p className="text-[14px] text-foreground">{contact.contact_name ?? 'No name given'}</p>
              {contact.contact_email && (
                <a
                  href={`mailto:${contact.contact_email}`}
                  className="text-[13px] text-foreground underline"
                >
                  {contact.contact_email}
                </a>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">
              This guest didn&apos;t leave contact details.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
