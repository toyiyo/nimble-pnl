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

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(status: number): Response {
  return json({ error: status >= 500 ? 'Something went wrong.' : 'Request could not be completed.' }, status);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0].trim() || 'unknown';
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400);
  }

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

  const since = new Date(Date.now() - REVIEW_RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from('review_responses')
    .select('id', { count: 'exact', head: true })
    .eq('review_page_id', page.id)
    .eq('ip_hash', ipHash)
    .gte('submitted_at', since);

  if (countError) {
    console.error('review-public: rate limit probe failed', countError);
    return fail(500);
  }
  if (isOverLimit(count ?? 0)) {
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

const MAX_COMMENT_LENGTH = 4000;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

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
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, MAX_EMAIL_LENGTH) : '';

  // Every early exit below returns the same shape. A caller cannot distinguish
  // a bot trip, a replay, an expiry, or a rate-limited drop from a real write.
  const ok = () => json({ ok: true });

  if (!token || !comment || comment.length > MAX_COMMENT_LENGTH) return fail(400);

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

  const since = new Date(Date.now() - REVIEW_RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from('review_responses')
    .select('id', { count: 'exact', head: true })
    .eq('review_page_id', existing.review_page_id)
    .eq('ip_hash', ipHash)
    .gte('submitted_at', since);

  if (countError) {
    console.error('review-public: comment rate probe failed', countError);
    return fail(500);
  }
  if (isOverLimit(count ?? 0)) {
    console.warn('review-public: rate limited on comment', {
      page_id: existing.review_page_id,
      ip_hash: ipHash,
    });
    return ok();
  }

  // `comment IS NULL` is what makes the token single-use: a replay updates
  // zero rows and still answers ok.
  const { data: updated, error: updateError } = await supabase
    .from('review_responses')
    .update({
      comment,
      contact_consent: consent,
      commented_at: new Date().toISOString(),
    })
    .eq('id', payload.rid)
    .is('comment', null)
    .select('id');

  if (updateError) {
    console.error('review-public: comment update failed', updateError);
    return fail(500);
  }
  if (!updated || updated.length === 0) return ok();

  // Consent false means the values are discarded, not stored and hidden.
  if (consent && (name || email)) {
    const { error: contactError } = await supabase
      .from('review_response_contacts')
      .insert({
        review_response_id: payload.rid,
        restaurant_id: '00000000-0000-0000-0000-000000000000', // overwritten by the trigger
        contact_name: name || null,
        contact_email: email || null,
      });
    if (contactError) {
      console.error('review-public: contact insert failed', contactError);
      // The comment itself is saved; the guest does not need to know.
    }
  }

  return ok();
}
