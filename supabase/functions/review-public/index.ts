// The only endpoint a guest's browser talks to.
//
// verify_jwt = false, so nothing about the caller is trusted. `page` reveals
// only what a table tent already reveals; `rate` decides the routing branch
// server-side and mints a short-lived HMAC token; `comment` accepts that token
// and nothing else as proof of which row the guest owns.
//
// Every failure returns a generic string. A guest must not be able to tell a
// missing slug from a paused one, a replayed token from an expired one, or a
// rate-limited drop from a successful write.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { signReviewToken, verifyReviewToken, REVIEW_TOKEN_TTL_SECONDS } from '../_shared/reviewToken.ts';
import { routeRating } from '../_shared/reviewRouting.ts';
import { hashIp, isOverLimit, REVIEW_RATE_WINDOW_MS } from '../_shared/reviewRateLimit.ts';
import { hasFollowUpPayload, isPlausibleEmail, MAX_EMAIL_LENGTH } from '../_shared/reviewContact.ts';

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(status: number): Response {
  return json({ error: status >= 500 ? 'Something went wrong.' : 'Request could not be completed.' }, status);
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]{2,45}$/;

function isPlausibleIp(value: string): boolean {
  const v4 = IPV4_PATTERN.exec(value);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255);
  return value.includes(':') && IPV6_PATTERN.test(value);
}

/**
 * X-Forwarded-For is a comma-separated hop chain that each proxy APPENDS to,
 * never overwrites. The left-most entry is whatever the connecting client
 * sent — fully attacker-controlled, since Supabase does not strip or
 * override a client-supplied X-Forwarded-For before this function sees it.
 * Trusting that entry let anyone reset their own rate-limit bucket on every
 * request by sending a fresh, arbitrary value. The right-most entry is what
 * Supabase's own gateway observed as its TCP peer, which a client cannot
 * spoof — so that's the one this rate limit's ip_hash is built from. A value
 * that doesn't parse as a plausible IPv4/IPv6 address falls back to a shared
 * 'unknown' bucket rather than being trusted verbatim.
 */
function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const hops = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  const candidate = hops[hops.length - 1] ?? '';
  return isPlausibleIp(candidate) ? candidate : 'unknown';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return fail(405);
  }

  const tokenSecret = Deno.env.get('REVIEW_TOKEN_SECRET');
  const ipPepper = Deno.env.get('REVIEW_IP_PEPPER');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!tokenSecret || !ipPepper || !supabaseUrl || !serviceKey) {
    console.error('review-public: missing required environment configuration');
    return fail(500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // `req.json()` resolves happily for any valid JSON document, not just an
  // object: `null`, `7`, `"x"` and `[]` all parse. Annotating the result
  // `Record<string, unknown>` is a lie TypeScript cannot catch at runtime, and
  // the `body.action` read below would throw a TypeError into the outer
  // handler — a 500 plus an "unhandled failure" log line for what is a
  // one-character request body. On an unauthenticated public endpoint that is
  // a free log-flooding primitive. Narrow the type where the data arrives.
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return fail(400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(400);
  }
  const body = parsed as Record<string, unknown>;

  const ipHash = await hashIp(clientIp(req), ipPepper);

  try {
    switch (body.action) {
      case 'page':
        return await handlePage(supabase, body);
      case 'rate':
        return await handleRate(supabase, body, ipHash, tokenSecret);
      case 'comment':
        return await handleComment(supabase, body, ipHash, tokenSecret);
      default:
        return fail(400);
    }
  } catch (err) {
    console.error('review-public: unhandled failure', err);
    return fail(500);
  }
});

type Supabase = ReturnType<typeof createClient>;

const LOGO_BUCKET = 'review-page-logos';

async function handlePage(supabase: Supabase, body: Record<string, unknown>): Promise<Response> {
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!slug) return fail(400);

  const { data, error } = await supabase
    .from('review_pages')
    .select('headline, subheadline, logo_path, promoter_threshold, is_active, restaurants(name)')
    .eq('slug', slug)
    .maybeSingle();

  // An unknown slug and a paused page are the same answer on purpose.
  if (error) {
    console.error('review-public: page lookup failed', error);
    return fail(500);
  }
  if (!data || !data.is_active) return json({ inactive: true });

  const logoUrl = data.logo_path
    ? supabase.storage.from(LOGO_BUCKET).getPublicUrl(data.logo_path).data.publicUrl
    : null;

  return json({
    restaurant_name: (data.restaurants as { name: string } | null)?.name ?? '',
    headline: data.headline,
    subheadline: data.subheadline,
    logo_url: logoUrl,
    threshold: data.promoter_threshold,
  });
}

async function handleRate(
  supabase: Supabase,
  body: Record<string, unknown>,
  ipHash: string,
  tokenSecret: string
): Promise<Response> {
  const slug = typeof body.slug === 'string' ? body.slug : '';
  const rating = typeof body.rating === 'number' ? body.rating : NaN;
  const honeypot = typeof body.hp === 'string' ? body.hp : '';

  if (!slug || !Number.isInteger(rating) || rating < 1 || rating > 5) return fail(400);

  const { data: page, error: pageError } = await supabase
    .from('review_pages')
    .select('id, promoter_threshold, destination_url, is_active')
    .eq('slug', slug)
    .maybeSingle();

  if (pageError) {
    console.error('review-public: rate page lookup failed', pageError);
    return fail(500);
  }
  if (!page || !page.is_active) return fail(400);

  // A filled honeypot is a bot. Answer exactly as a success would, write
  // nothing, and mint a token that resolves to no row.
  if (honeypot) {
    console.warn('review-public: honeypot tripped', { page_id: page.id, ip_hash: ipHash });
    return json({ token: await signReviewToken({ rid: crypto.randomUUID(), exp: expiry() }, tokenSecret), routed_to: 'feedback' });
  }

  const recentCount = await countRecentResponses(supabase, page.id, ipHash);
  if (recentCount === null) return fail(500);
  if (isOverLimit(recentCount)) {
    console.warn('review-public: rate limited', { page_id: page.id, ip_hash: ipHash });
    return json({ token: await signReviewToken({ rid: crypto.randomUUID(), exp: expiry() }, tokenSecret), routed_to: 'feedback' });
  }

  const decision = routeRating(rating, page.promoter_threshold, page.destination_url);

  const { data: inserted, error: insertError } = await supabase
    .from('review_responses')
    .insert({
      review_page_id: page.id,
      restaurant_id: '00000000-0000-0000-0000-000000000000', // overwritten by the trigger
      rating,
      routed_to: decision.routedTo,
      ip_hash: ipHash,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    console.error('review-public: rate insert failed', insertError);
    return fail(500);
  }

  const token = await signReviewToken({ rid: inserted.id, exp: expiry() }, tokenSecret);

  return json(
    decision.routedTo === 'destination'
      ? { token, routed_to: decision.routedTo, destination_url: decision.destinationUrl }
      : { token, routed_to: decision.routedTo }
  );
}

function expiry(): number {
  return Math.floor(Date.now() / 1000) + REVIEW_TOKEN_TTL_SECONDS;
}

/**
 * Shared by handleRate and handleComment: how many responses this
 * (page, ip_hash) pair has logged in the trailing window. Returns null on a
 * query failure so the caller can answer with a generic 500 instead of
 * leaking which of the two write paths broke.
 *
 * `excludeResponseId` is set by handleComment to its own rating's row id.
 * Without it, a guest's own rating — inserted by handleRate moments earlier,
 * and still inside the window — counts against their immediate follow-up
 * comment call. At exactly the 120th rating for a (page, ip_hash) pair that
 * made handleComment's count 120 where handleRate's had been 119, silently
 * dropping a comment the ceiling was never meant to touch.
 */
async function countRecentResponses(
  supabase: Supabase,
  pageId: string,
  ipHash: string,
  excludeResponseId?: string
): Promise<number | null> {
  const since = new Date(Date.now() - REVIEW_RATE_WINDOW_MS).toISOString();
  let query = supabase
    .from('review_responses')
    .select('id', { count: 'exact', head: true })
    .eq('review_page_id', pageId)
    .eq('ip_hash', ipHash)
    .gte('submitted_at', since);
  if (excludeResponseId) {
    query = query.neq('id', excludeResponseId);
  }
  const { count, error } = await query;

  if (error) {
    console.error('review-public: rate limit probe failed', error);
    return null;
  }
  return count ?? 0;
}

const MAX_COMMENT_LENGTH = 4000;
const MAX_NAME_LENGTH = 200;

async function handleComment(
  supabase: Supabase,
  body: Record<string, unknown>,
  ipHash: string,
  tokenSecret: string
): Promise<Response> {
  const token = typeof body.token === 'string' ? body.token : '';
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  const honeypot = typeof body.hp === 'string' ? body.hp : '';
  const consent = body.consent === true;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';

  // Validate the raw, untruncated email before any slice. A slice-then-check
  // order let a caller send a 400-character string, watch the server cut it
  // to MAX_EMAIL_LENGTH, and have the server store an address the guest
  // never typed.
  const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';

  // A comment carries the payload on its own, so an email-only request has
  // no fallback: an over-length email must fail loud here, not fall through
  // to the generic hasFollowUpPayload 400 below as if it were merely
  // malformed.
  if (!comment && rawEmail.length > MAX_EMAIL_LENGTH) return fail(400);

  // A comment-bearing request drops an invalid or over-length email and
  // keeps the comment. Truncation happens only now, after the raw value has
  // passed every check.
  const email = comment && !isPlausibleEmail(rawEmail) ? '' : rawEmail.slice(0, MAX_EMAIL_LENGTH);

  // A malformed request is answered honestly with a 400 — that tells an
  // attacker nothing they did not already know about their own payload.
  if (!token || comment.length > MAX_COMMENT_LENGTH) return fail(400);

  // The comment is optional, the payload is not. A request with neither a
  // comment nor a usable email writes nothing, so it stays a 400.
  if (!hasFollowUpPayload({ comment, consent, email })) return fail(400);

  // Past this point every early exit returns the same shape, so a caller
  // holding a well-formed request cannot distinguish a bot trip, a replay, an
  // expiry, or a rate-limited drop from a real write.
  const ok = () => json({ ok: true });

  if (honeypot) {
    console.warn('review-public: honeypot tripped on comment', { ip_hash: ipHash });
    return ok();
  }

  const payload = await verifyReviewToken(token, tokenSecret);
  if (!payload) return ok();

  const { data: existing, error: lookupError } = await supabase
    .from('review_responses')
    .select('id, review_page_id')
    .eq('id', payload.rid)
    .maybeSingle();

  if (lookupError) {
    console.error('review-public: comment lookup failed', lookupError);
    return fail(500);
  }
  if (!existing) return ok();

  const recentCount = await countRecentResponses(supabase, existing.review_page_id, ipHash, existing.id);
  if (recentCount === null) return fail(500);
  if (isOverLimit(recentCount)) {
    console.warn('review-public: rate limited on comment', {
      page_id: existing.review_page_id,
      ip_hash: ipHash,
    });
    return ok();
  }

  // review_response_submit_followup runs the guarded UPDATE and, on
  // consent, the review_response_contacts INSERT inside one implicit
  // transaction. `commented_at IS NULL` is what makes the token single-use:
  // a replay updates zero rows and still answers ok. `comment IS NULL`
  // cannot do that job — a contact-only submit leaves the comment NULL, so
  // a replay would match again and hit the primary key on
  // review_response_contacts. The RPC is the only writer of `commented_at`,
  // so the guard rejects every replay. A failed contact insert now rolls
  // the UPDATE back too, so `commented_at` stays NULL and a retry works.
  //
  // An empty comment stores as NULL, not as an empty string.
  // `review_response_metrics` counts `comment IS NOT NULL`, so an empty
  // string would inflate the comment count and put a blank row in the inbox.
  const { error: writeError } = await supabase.rpc('review_response_submit_followup', {
    p_response_id: payload.rid,
    p_comment: comment || null,
    p_consent: consent,
    p_name: name || null,
    p_email: email || null,
  });

  // The RPC returns false on a replay (zero rows updated) and true on a
  // real write. The caller answers ok() either way, so it cannot tell them
  // apart.
  if (writeError) {
    console.error('review-public: comment write failed', writeError);
    return fail(500);
  }
  return ok();
}
