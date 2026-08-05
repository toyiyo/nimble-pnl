import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import { StarRating } from '@/components/reviews/StarRating';

import {
  classifyReviewPageResponse,
  type PublicReviewPage,
  type ReviewPageLoadState,
} from '@/lib/reviews/reviewPageLoad';

import { supabase } from '@/integrations/supabase/client';

import '@fontsource/zilla-slab/400.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@/styles/counter-theme.css';

type Stage = 'land' | 'promoter' | 'feedback' | 'thanks';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export default function ReviewPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  const [load, setLoad] = useState<ReviewPageLoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);

  const [preview, setPreview] = useState(0);
  const [committed, setCommitted] = useState(0);
  const [stage, setStage] = useState<Stage>('land');
  const [token, setToken] = useState<string | null>(null);
  const [destinationUrl, setDestinationUrl] = useState<string | null>(null);

  const [comment, setComment] = useState('');
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [rateError, setRateError] = useState(false);

  const [announcement, setAnnouncement] = useState('');
  const branchHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // The write guard is a ref, not the `committed` state: React batches state
  // updates, so a double-tap or a click landing on the same frame as an Enter
  // would see `committed === 0` twice and file two ratings. The state is what
  // renders; the ref is what decides.
  const committedRef = useRef(0);
  const errorHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke('review-public', {
        body: { action: 'page', slug },
      });
      if (cancelled) return;
      const result = classifyReviewPageResponse(data, error);
      setLoad(result);
      if (result.kind === 'error') {
        setFailures((count) => count + 1);
        setAnnouncement('Something went wrong loading this page.');
      } else if (result.kind === 'inactive') {
        setAnnouncement("This link isn't active.");
      } else {
        setAnnouncement(`${result.page.restaurant_name}. ${result.page.headline}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  useEffect(() => {
    if (stage !== 'land') branchHeadingRef.current?.focus();
  }, [stage]);

  // `attempt` is in the deps because `load.kind` alone does not change between
  // two consecutive failures — without it, a retry that fails again would leave
  // focus wherever the unmounted button dropped it.
  useEffect(() => {
    if (load.kind === 'error') errorHeadingRef.current?.focus();
  }, [load.kind, attempt]);

  const handlePreview = useCallback((rating: number) => {
    setPreview(rating);
    setAnnouncement(`${rating} out of 5 stars`);
  }, []);

  const handleRetry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  const handleCommit = useCallback(
    async (rating: number) => {
      if (committedRef.current) return;
      committedRef.current = rating;
      setCommitted(rating);
      setPreview(rating);
      setRateError(false);

      const { data, error } = await supabase.functions.invoke('review-public', {
        body: { action: 'rate', slug, rating, hp: honeypot },
      });

      // Nothing came back, so nothing was filed as far as this client can
      // know. Saying "thanks, your rating was received" here would be a
      // straight lie to the one guest in a hundred whose tap failed, and it
      // would strand them: the write guard is already armed, so the stars
      // would sit inert behind a thank-you for a rating the restaurant never
      // got. Disarm the guard, restore the stars, and say what happened.
      if (error || !data?.token) {
        committedRef.current = 0;
        setCommitted(0);
        setPreview(0);
        setRateError(true);
        setAnnouncement("That didn't send. Tap a star to try again.");
        return;
      }

      setToken(data.token as string);
      if (data.routed_to === 'destination') {
        setDestinationUrl((data.destination_url as string) ?? null);
        setStage('promoter');
        setAnnouncement('Thanks. You can share this on Google.');
      } else {
        setStage('feedback');
        setAnnouncement('Tell us what happened. This goes straight to the owner.');
      }
    },
    [honeypot, slug]
  );

  const handleSubmitComment = useCallback(async () => {
    if (!token || !comment.trim()) return;
    setSubmitting(true);
    setSubmitError(false);

    const { error } = await supabase.functions.invoke('review-public', {
      body: {
        action: 'comment',
        token,
        comment: comment.trim(),
        consent,
        name: consent ? name : undefined,
        email: consent ? email : undefined,
        hp: honeypot,
      },
    });

    setSubmitting(false);
    if (error) {
      setSubmitError(true);
      return;
    }
    setStage('thanks');
  }, [comment, consent, email, honeypot, name, token]);

  const card = 'w-full max-w-md rounded-lg border border-border bg-card px-6 py-8 shadow-sm';

  // Every load state renders through the same shell so the polite region is
  // mounted throughout — a region that appears with its own text is not
  // announced, which is what used to happen on this page.
  const shell = (children: ReactNode) => (
    <main className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className={card}>{children}</div>
    </main>
  );

  if (load.kind === 'loading') {
    return shell(
      <>
        <Skeleton className="mx-auto h-14 w-14 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-5 w-40" />
        <Skeleton className="mx-auto mt-6 h-10 w-56" />
      </>
    );
  }

  if (load.kind === 'inactive') {
    return shell(
      <>
        <h1 className="counter-display text-[22px] font-semibold text-foreground text-center">
          This link isn&apos;t active
        </h1>
        <p className="counter-micro mt-3 text-[12px] text-muted-foreground text-center">
          Ask the restaurant for a current one.
        </p>
      </>
    );
  }

  if (load.kind === 'error') {
    return shell(
      <>
        <h1
          ref={errorHeadingRef}
          tabIndex={-1}
          className="counter-display text-[22px] font-semibold text-foreground text-center focus:outline-none"
        >
          Something went wrong
        </h1>
        <p className="counter-micro mt-3 text-[12px] text-muted-foreground text-center">
          {failures > 1
            ? 'Still not working. Give it a minute and try again.'
            : "That's on us, not you."}
        </p>
        <Button
          type="button"
          onClick={handleRetry}
          className="mt-6 h-11 w-full rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
        >
          Try again
        </Button>
      </>
    );
  }

  const page: PublicReviewPage = load.page;

  return shell(
    <>
      <div className="flex flex-col items-center">
        {page.logo_url ? (
          <img
            src={page.logo_url}
            alt=""
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="counter-display flex h-14 w-14 items-center justify-center rounded-full bg-muted text-[18px] font-semibold text-foreground"
          >
            {initials(page.restaurant_name)}
          </div>
        )}
        <p className="counter-micro mt-3 text-[12px] uppercase tracking-wider text-muted-foreground">
          {page.restaurant_name}
        </p>
      </div>

      <div className="counter-rule my-6" />

      {stage === 'land' && (
        <>
          <h1 className="counter-display text-center text-[26px] font-semibold text-foreground">
            {page.headline}
          </h1>
          {page.subheadline && (
            <p className="mt-2 text-center text-[14px] text-muted-foreground">
              {page.subheadline}
            </p>
          )}
          <div className="mt-6">
            <StarRating
              value={preview}
              onPreview={handlePreview}
              onCommit={handleCommit}
              disabled={committed > 0}
            />
          </div>
          {rateError ? (
            <div className="mt-6 rounded-lg border border-border px-3 py-2 text-center text-[13px] text-foreground">
              That didn&apos;t send. Tap a star to try again.
            </div>
          ) : (
            <p className="counter-micro mt-6 text-center text-[12px] text-muted-foreground">
              tap a star — 10 seconds, no account
            </p>
          )}
        </>
      )}

      {stage === 'promoter' && (
        <>
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            Thank you
          </h1>
          <p className="mt-2 text-center text-[14px] text-muted-foreground">
            Would you share that on Google? It takes about a minute.
          </p>
          {destinationUrl && (
            <a
              href={destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
            >
              Leave a Google review
            </a>
          )}
          <button
            type="button"
            onClick={() => setStage('thanks')}
            className="counter-micro mt-4 w-full text-center text-[12px] text-muted-foreground underline"
          >
            No thanks
          </button>
        </>
      )}

      {stage === 'feedback' && (
        <>
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            What happened?
          </h1>
          <p className="counter-micro mt-2 text-center text-[12px] text-muted-foreground">
            this goes straight to the owner — not public
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="review-comment" className="text-[13px] text-foreground">
                Your feedback
              </Label>
              <Textarea
                id="review-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
                className="mt-1.5 bg-background border-border"
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="review-consent"
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              <Label htmlFor="review-consent" className="text-[13px] text-muted-foreground">
                It&apos;s OK to contact me about this
              </Label>
            </div>

            {consent && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="review-name" className="text-[13px] text-foreground">
                    Name
                  </Label>
                  <Input
                    id="review-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1.5 bg-background border-border"
                  />
                </div>
                <div>
                  <Label htmlFor="review-email" className="text-[13px] text-foreground">
                    Email
                  </Label>
                  <Input
                    id="review-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1.5 bg-background border-border"
                  />
                </div>
              </div>
            )}

            {/* Honeypot: aria-hidden and untabbable so assistive tech never offers it. */}
            <input
              type="text"
              name="hp"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
              tabIndex={-1}
              aria-hidden="true"
              autoComplete="off"
              className="absolute left-[-9999px] h-px w-px opacity-0"
            />

            {submitError && (
              <div className="rounded-lg border border-border px-3 py-2 text-[13px] text-foreground">
                That didn&apos;t send. Your rating is already saved — try once more.
              </div>
            )}

            <Button
              type="button"
              onClick={handleSubmitComment}
              disabled={submitting || comment.trim().length === 0}
              className="h-11 w-full rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
            >
              {submitting ? 'Sending…' : 'Send to the owner'}
            </Button>
          </div>
        </>
      )}

      {stage === 'thanks' && (
        <>
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            Thanks for telling us
          </h1>
          <p className="counter-micro mt-3 text-center text-[12px] text-muted-foreground">
            have a good one
          </p>
        </>
      )}

      <div className="counter-rule mt-8" />
    </>
  );
}
