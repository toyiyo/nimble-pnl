# Design — Trial-expiry email sequence

**Branch:** `feat/trial-expiry-emails`
**Date:** 2026-05-07
**Author:** Jose (via Claude Code)

## Goal

Send a 4-email lifecycle sequence to restaurants in a 14-day "no card" trial. Emails escalate from helpful (day 7) to direct (day 13) to "your trial just ended" (day 15). Each email has two voice variants based on whether the restaurant has connected a POS (the activation milestone). Voice is operator-to-operator, signed by Jose.

This is the highest-leverage piece of conversion infrastructure for a trial-no-card SaaS — the trial **is** the sales process.

## Source-of-truth survey

Before designing, here is what already exists in nimble-pnl that diverges from the brief.

| Brief assumption | Actual nimble-pnl state |
|---|---|
| `stripe_subscriptions` table keyed by `user_id` | Subscription state lives **on `restaurants`**: `subscription_status`, `subscription_tier`, `trial_ends_at`. Per-RESTAURANT, not per-user. |
| `pos_integrations` table with `status='active'` | **Four** per-POS tables: `square_connections`, `toast_connections`, `clover_connections`, `shift4_connections`. Each has `restaurant_id` FK. Existence in any one ⇒ activated. |
| `profiles.is_internal` flag | Not present. Internal exclusion will use `email LIKE '%@easyshifthq.com'` and `'%@camiluke.com'`. |
| `profiles.full_name` | Present. |
| Cron via `supabase/config.toml` schedule blocks | All cron lives in **pg_cron + pg_net** inside SQL migrations. `config.toml` only lists `verify_jwt` per function. |
| Marketing-leads brief shipped (Resend client + unsubscribe helper) | **Not** shipped. We must build the unsubscribe infrastructure here, designed so the marketing brief can reuse it. |
| Resend SDK v3 | Existing edge functions use `Resend` from `https://esm.sh/resend@4.0.0`. We will match. |

What already exists and we will reuse:
- `supabase/functions/_shared/cors.ts` — standard CORS headers.
- `supabase/functions/_shared/posthogServer.ts` — `captureServerEvent({ distinctId, event, properties })`.
- `supabase/functions/send-team-invitation/index.ts` — reference for Resend SDK + service-role pattern.
- `supabase/functions/stripe-subscription-webhook/subscription-handler.ts` — reference for PostHog server-side capture.

## User-facing decisions (locked in)

1. **Recipient model: per-restaurant, all owners.** Iterate restaurants in trial. Each owner gets one email per `(restaurant_id, email_type)` pair. Multi-restaurant operators see one email per trialing restaurant — the email is contextual to that restaurant's trial, not the user's general state.
2. **Status filter: `subscription_status = 'trialing'` only.** Skips paid (`active`/`past_due`), opted-out (`canceled`), and freebie (`grandfathered`) restaurants.
3. **Internal exclusion: email-LIKE filter.** Skip `%@easyshifthq.com` and `%@camiluke.com`.
4. **FROM: `Jose at EasyShiftHQ <jose.delgado@easyshifthq.com>`.** Direct sender, no Reply-To shim.

## Non-goals

- We are **not** auto-charging anyone or auto-extending trials.
- We are **not** sending to `canceled` or `past_due` users — they had a chance and made their decision.
- We are **not** retroactively emailing users older than 16 days at deploy time — the trial-day window in the RPC handles this naturally.
- We are **not** mixing in lead-magnet promotions; the sequence is laser-focused on trial → paid.
- We are **not** building a granular preference center. One unsubscribe = "stop the trial-lifecycle list." Future marketing uses a separate list.
- No UI work in app shell — the only frontend addition is the public `/unsubscribe` page.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  pg_cron job daily @ 09:00 UTC                                        │
│    │                                                                  │
│    ▼                                                                  │
│  net.http_post → Edge function `trial-expiry-emails` (verify_jwt=false)│
│    │                                                                  │
│    │  1. supabase.rpc('users_in_trial_email_window')                  │
│    │     ↓ returns rows: {restaurant_id, user_id, email,             │
│    │                       full_name, trial_day, activated, email_type}│
│    │     The RPC encapsulates:                                        │
│    │       • status = 'trialing'                                      │
│    │       • trial_day in (7,11,13,15) computed in UTC                │
│    │       • activated = exists in any POS connection table           │
│    │       • internal-email exclusion                                 │
│    │       • dedupe (NOT EXISTS in trial_emails_sent)                 │
│    │       • unsubscribe filter (NOT EXISTS in email_unsubscribes)    │
│    │                                                                  │
│    │  2. For each row:                                                │
│    │       a. Render template (email_type × variant)                  │
│    │       b. Send via Resend                                         │
│    │       c. INSERT into trial_emails_sent (dedupe row)              │
│    │       d. captureServerEvent('trial_email_sent')                  │
│    │                                                                  │
│    └─ Return 200 JSON { ok, count, results[] }                        │
│                                                                       │
│  Frontend: /unsubscribe?token=...&list=trial_lifecycle                │
│    Confirms unsubscribe via POST to edge function `unsubscribe-email` │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Data model

### New table: `public.trial_emails_sent`

Idempotency / dedupe ledger. One row per (restaurant, owner, email_type) sent.

```sql
create table public.trial_emails_sent (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_type text not null check (email_type in ('halfway', '3_days', 'tomorrow', 'expired')),
  variant text not null check (variant in ('activated', 'not_activated')),
  sent_at timestamptz not null default now(),
  resend_message_id text,
  trial_day_at_send integer not null,
  unique (restaurant_id, user_id, email_type)
);

create index trial_emails_sent_user_idx on public.trial_emails_sent(user_id);
create index trial_emails_sent_restaurant_idx on public.trial_emails_sent(restaurant_id);
create index trial_emails_sent_sent_at_idx on public.trial_emails_sent(sent_at desc);

alter table public.trial_emails_sent enable row level security;
-- No policies. Service-role bypasses RLS for the edge function. Locked-down by default.
```

### New table: `public.email_unsubscribes`

Per-list unsubscribe ledger. Designed to be reusable by the marketing-leads brief later.

```sql
create table public.email_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list text not null check (list in ('trial_lifecycle', 'marketing', 'all')),
  unsubscribed_at timestamptz not null default now(),
  source text,  -- e.g., 'trial_email_link', 'list_unsubscribe_header', 'admin'
  unique (user_id, list)
);

create index email_unsubscribes_user_idx on public.email_unsubscribes(user_id);

alter table public.email_unsubscribes enable row level security;
-- Service-role bypasses RLS. Future: add a policy letting users see their own unsubscribes.
```

### New RPC: `public.users_in_trial_email_window()`

Returns the candidate set after applying every filter (status, trial-day, internal, dedupe, unsubscribe). The edge function loops over this without further checks.

```sql
create or replace function public.users_in_trial_email_window()
returns table (
  restaurant_id uuid,
  user_id uuid,
  email text,
  full_name text,
  trial_day integer,
  activated boolean,
  email_type text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with day_map as (
    select unnest(array[7, 11, 13, 15]) as d,
           unnest(array['halfway','3_days','tomorrow','expired']::text[]) as t
  ),
  candidates as (
    select
      r.id as restaurant_id,
      ur.user_id,
      u.email::text,
      coalesce(p.full_name, u.raw_user_meta_data->>'full_name', '')::text as full_name,
      ((now() at time zone 'UTC')::date - (r.created_at at time zone 'UTC')::date)::integer as trial_day,
      exists (select 1 from public.square_connections sc where sc.restaurant_id = r.id)
        or exists (select 1 from public.toast_connections tc where tc.restaurant_id = r.id)
        or exists (select 1 from public.clover_connections cc where cc.restaurant_id = r.id)
        or exists (select 1 from public.shift4_connections s4 where s4.restaurant_id = r.id)
        as activated
    from public.restaurants r
    join public.user_restaurants ur on ur.restaurant_id = r.id and ur.role = 'owner'
    join auth.users u on u.id = ur.user_id
    left join public.profiles p on p.user_id = u.id
    where r.subscription_status = 'trialing'
      and u.email is not null
      and u.email not like '%@easyshifthq.com'
      and u.email not like '%@camiluke.com'
  )
  select
    c.restaurant_id,
    c.user_id,
    c.email,
    c.full_name,
    c.trial_day,
    c.activated,
    dm.t as email_type
  from candidates c
  join day_map dm on dm.d = c.trial_day
  where not exists (
    select 1 from public.trial_emails_sent tes
    where tes.restaurant_id = c.restaurant_id
      and tes.user_id = c.user_id
      and tes.email_type = dm.t
  )
  and not exists (
    select 1 from public.email_unsubscribes eu
    where eu.user_id = c.user_id
      and eu.list in ('trial_lifecycle', 'all')
  );
end;
$$;

grant execute on function public.users_in_trial_email_window() to service_role;
```

Key design notes:
- **TZ-safe day math.** `(now() at time zone 'UTC')::date - (r.created_at at time zone 'UTC')::date`. Cron runs at 09:00 UTC; the math is anchored in UTC end-to-end. Avoids the host-TZ flakiness pattern from lessons.md [2026-05-03].
- **Profiles via public schema.** `auth.users` is joined directly (we need the email and raw_user_meta_data). Lessons.md [2026-04-22] warns against PostgREST embeds traversing schemas, but this is plpgsql — direct SQL JOINs across schemas work fine inside `SECURITY DEFINER` functions. Confirmed by reviewing `create_restaurant_with_owner` which also touches `auth.uid()` from public schema.
- **Per-restaurant POS check.** Existence across 4 connection tables. If we add a 5th POS, this RPC must be updated.
- **No retroactive email storm.** `trial_day in (7,11,13,15)` filters tightly — when this code first deploys, only restaurants whose `created_at` is within the right windows get touched. Older trialing restaurants (day 16+) are skipped naturally.

## Edge function: `trial-expiry-emails`

Path: `supabase/functions/trial-expiry-emails/index.ts`

```ts
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@4.0.0';

import { corsHeaders } from '../_shared/cors.ts';
import { captureServerEvent } from '../_shared/posthogServer.ts';
import { unsubscribeTokenFor } from '../_shared/unsubscribeToken.ts';
import { renderTrialEmail } from '../_shared/trialEmailTemplates.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('TRIAL_EMAIL_FROM') ?? 'Jose at EasyShiftHQ <jose.delgado@easyshifthq.com>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.easyshifthq.com';
const PUBLIC_URL = Deno.env.get('PUBLIC_URL') ?? 'https://easyshifthq.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const resend = new Resend(RESEND_API_KEY);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // ... (see plan for exact body)
});
```

Loop body, per candidate row:
1. Render email (template module, pure function).
2. `resend.emails.send(...)` — return 200 success or log + continue on failure.
3. INSERT into `trial_emails_sent` with `resend_message_id`, `variant`, `trial_day_at_send`.
4. `captureServerEvent({ distinctId: user_id, event: 'trial_email_sent', properties: { restaurant_id, email_type, variant, trial_day } })`.
5. Push `{ user_id, email_type, status: 'sent' }` into the response array.

Return shape:
```json
{ "ok": true, "count": N, "results": [{ "user_id":"...", "email_type":"halfway", "status":"sent" }, ...] }
```

Error handling:
- Per-row errors are caught, logged, and reported as `status: "send_failed"` in the response. The function still returns 200 — partial failure must not crash the whole batch.
- Top-level errors (RPC fails, Supabase unreachable) return 500 with a generic message; details only logged server-side. (Lessons.md [2026-04-22] — never leak raw error messages.)

## Email templates

Module: `supabase/functions/_shared/trialEmailTemplates.ts`

Pure module, no Deno-specific imports — runnable in Vitest unit tests.

Public API:
```ts
export type EmailType = 'halfway' | '3_days' | 'tomorrow' | 'expired';
export type Variant = 'activated' | 'not_activated';

export interface TemplateContext {
  firstName: string;          // 'Jose' or 'there' fallback
  unsubscribeUrl: string;     // already-built absolute URL
  appUrl: string;             // dashboard link target
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;               // plain-text fallback for clients that strip HTML
}

export function renderTrialEmail(
  type: EmailType,
  variant: Variant,
  ctx: TemplateContext,
): RenderedEmail;
```

Layout details:
- Wrapper HTML: `<body>` with `font-family: Arial, sans-serif`, `max-width: 560px`, neutral palette (`#1c1917` text, `#a8a29e` secondary, `#c2410c` link orange, `#e7e5e4` border).
- All eight templates already drafted in the brief — copy preserved verbatim.
- Plain-text version generated by stripping HTML tags + collapsing whitespace.
- Sig block: `— Jose / Founder, EasyShiftHQ / Operator running a Cold Stone / Wetzel's co-brand in San Antonio.`

## Unsubscribe infrastructure

### HMAC token helper

Module: `supabase/functions/_shared/unsubscribeToken.ts`

```ts
export interface TokenOpts {
  userId: string;
  secret: string;  // pulled from UNSUBSCRIBE_TOKEN_SECRET
}

export function unsubscribeTokenFor(opts: TokenOpts): string;
export function verifyUnsubscribeToken(token: string, opts: TokenOpts): boolean;
```

Implementation: `HMAC-SHA256(userId, secret)`, hex-encoded. Web Crypto API (`crypto.subtle`) — works in both Deno and browser (Vitest+jsdom).

Why HMAC over `userId` only: the brief specifies it (so tokens are sharable between trial-lifecycle and future marketing flows). The `list` parameter is passed separately and not bound to the token, which means a token leaks unsubscribe-from-anything power for the user's own lists. Acceptable for MVP.

### Unsubscribe edge function

Path: `supabase/functions/unsubscribe-email/index.ts`. `verify_jwt = false`.

Accepts POST with `?token=...&user_id=...&list=...` query params.

Logic:
1. Verify HMAC token against `user_id` using `UNSUBSCRIBE_TOKEN_SECRET`.
2. Validate `list` is one of the allow-listed values.
3. INSERT into `email_unsubscribes` with `ON CONFLICT (user_id, list) DO NOTHING`.
4. Return 200 `{ ok: true }`.

HTTP codes (lessons.md [2026-04-21]):
- 400 if token invalid or list invalid.
- 404 if user not found (rare, but possible if user was deleted).
- 500 only for unhandled internals.

### Unsubscribe page (frontend)

Path: `src/pages/Unsubscribe.tsx`. Public route (no auth required).

Reads `token`, `user_id`, `list` from URL params. UI states:
- **Confirm** (initial): "Stop receiving emails from EasyShiftHQ?" with a button.
- **Submitting**: spinner + "Unsubscribing..."
- **Success**: "You're unsubscribed. We won't send any more `<list-display-name>` emails."
- **Error**: "We couldn't process this link. Try again or email jose.delgado@easyshifthq.com."

Click handler POSTs to `${SUPABASE_URL}/functions/v1/unsubscribe-email?...`.

Apple/Notion styling per CLAUDE.md — semantic tokens only, `text-[14px]`, `text-foreground`/`text-muted-foreground`.

Wired into `App.tsx` as `<Route path="/unsubscribe" element={<Unsubscribe />} />`. Add this route OUTSIDE any `<ProtectedRoute>` wrapper.

### Email headers

Every trial email gets:
```
List-Unsubscribe: <https://app.easyshifthq.com/functions/v1/unsubscribe-email?token=<HMAC>&user_id=<UUID>&list=trial_lifecycle>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Body unsubscribe link points to the same URL but on the public app page, e.g.
```
https://easyshifthq.com/unsubscribe?token=<HMAC>&user_id=<UUID>&list=trial_lifecycle
```

This way Gmail's one-click unsubscribe (POST to the function URL) works, AND human readers clicking the body link get the confirmation page.

## Cron schedule

Migration: `supabase/migrations/<ts>_schedule_trial_expiry_emails.sql`

```sql
SELECT cron.schedule(
  'trial-expiry-emails',
  '0 9 * * *',  -- daily 09:00 UTC = 4am Central; lands mid-morning local
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/trial-expiry-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

`config.toml` adds:
```toml
[functions.trial-expiry-emails]
verify_jwt = false

[functions.unsubscribe-email]
verify_jwt = false
```

(`verify_jwt = false` because pg_cron isn't passing a user JWT, and the unsubscribe endpoint must be reachable from email clients without auth. Both functions instead authenticate via the service role key in the Authorization header for cron, and via HMAC token for unsubscribe.)

## Environment variables

Add to Supabase project + local `.env.local`:

```
RESEND_API_KEY=re_xxx                  # already configured
TRIAL_EMAIL_FROM=Jose at EasyShiftHQ <jose.delgado@easyshifthq.com>
SUPABASE_URL=...                       # already
SUPABASE_SERVICE_ROLE_KEY=...          # already
APP_URL=https://app.easyshifthq.com    # already (or set if missing)
PUBLIC_URL=https://easyshifthq.com     # for public-facing unsubscribe link
UNSUBSCRIBE_TOKEN_SECRET=<32+ bytes random>  # NEW; share with marketing-leads when shipped
POSTHOG_PROJECT_KEY=...                # already
POSTHOG_HOST=...                       # already
```

## Observability

- **PostHog event:** `trial_email_sent` with `{ restaurant_id, email_type, variant, trial_day, resend_message_id }`. Fired only on successful Resend send. Distinct ID = `user_id`. Lets the Growth dashboard build a `trial_email_sent` → `subscription_created` conversion funnel by email_type and variant.
- **Edge-function logs:** structured JSON via `console.log` for every send, dedupe-skip, and error. Includes `restaurant_id`, `user_id`, `email_type`, status.

## Testing strategy

Coverage requirement: ≥80% on new code (SonarCloud gate). Lessons.md [2026-04-25] — direct-import tests required, mocks-only don't count.

| Test | Location | Coverage |
|------|----------|----------|
| Template rendering — every type × variant | `tests/unit/trialEmailTemplates.test.ts` | All 8 outputs, presence of unsubscribe URL, signature block, no broken HTML |
| `unsubscribeTokenFor` / `verifyUnsubscribeToken` | `tests/unit/unsubscribeToken.test.ts` | round-trip, tampering rejected, secret mismatch rejected |
| Day-math RPC | `supabase/tests/17_users_in_trial_email_window.sql` (pgTAP) | day 7/11/13/15 included; day 6/8/12/14/16 excluded; trialing-only filter; internal-email exclusion; dedupe via existing trial_emails_sent row; unsubscribe filter |
| Activation detection | same pgTAP file | inserting square/toast/clover/shift4 connection flips `activated` to true |
| `trial_emails_sent` constraints | same pgTAP file | unique constraint on (restaurant_id, user_id, email_type) |
| Edge function happy path + dedupe | `tests/unit/trialExpiryEmails.test.ts` (mocked supabase + resend) | RPC returns 2 rows → resend called twice, INSERT called twice, posthog called twice; second invocation with same dedupe row → no resend |
| Unsubscribe page happy/error | `tests/unit/Unsubscribe.test.tsx` | renders confirm UI; click POSTs; success state shown; bad token shows error |

pgTAP fixture pattern (lessons.md [2026-04-22]):
- `BEGIN; ... ROLLBACK;`
- Disable RLS on `restaurants`, `user_restaurants`, `auth.users`, `profiles` for the duration of the test.
- Delete-before-insert in FK-safe order; do not rely on `ON CONFLICT DO NOTHING`.
- Use `now() - interval '7 days'` etc. for relative dates; never hardcoded.

## Verification before merge

- [ ] Migration applies cleanly: `npm run db:reset` succeeds with all three new migrations.
- [ ] `npm run test:db` green.
- [ ] `npm run test` green (≥80% coverage on new files).
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` green.
- [ ] Manual: invoke edge function with a fixture user — observe email + `trial_emails_sent` row + PostHog event.
- [ ] Manual: re-invoke; verify NO duplicate email and NO duplicate row.
- [ ] Manual: visit unsubscribe page with a valid token; verify row written and subsequent emails skipped.
- [ ] Manual: visit unsubscribe page with a tampered token; verify error state.
- [ ] Cron registers: `select * from cron.job where jobname = 'trial-expiry-emails';` shows the row.
- [ ] Internal users excluded: insert a fixture user with `email = 'foo@easyshifthq.com'`, confirm RPC does not return them.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Resend rate limits during the first cron run after deploy | Sequential loop within the function; if backlog grows, add batching/pagination later. Initial deploy will only have ~handful of restaurants in trial windows simultaneously. |
| Edge-function CPU limit (~10s) on a large batch | Each iteration is tiny (template render + 1 Resend POST + 1 INSERT + 1 PostHog send). 50 emails per run fits comfortably. If we exceed, paginate by trial_day. |
| User has multiple owners → spam if all owners get the same email | By design: every owner of a trialing restaurant gets the email. Most restaurants have 1 owner. The brief explicitly wants the operator (owner) to act. |
| User signed up in late-evening UTC, trial_day is off-by-one in their local TZ | Acceptable: the email lands in their inbox at a consistent UTC offset from creation. Worth ±1 day's drift; the copy doesn't reference exact times. |
| Pre-fetching email security scanners auto-trigger unsubscribe | Mitigated by confirmation-page UI (GET shows form, POST does the action). Gmail's one-click POST is intentional and safe. |
| `UNSUBSCRIBE_TOKEN_SECRET` rotated → old tokens stop working | Documented as one-way: rotate only when forced, accept that old emails' unsubscribe links break. |
| Marketing-leads brief later wants different unsubscribe semantics | The `list` column in `email_unsubscribes` accommodates multiple lists; both flows can coexist. |

## Out-of-scope (next iteration)

- Re-subscribe flow (currently no UI to undo an unsubscribe).
- Per-recipient personalization beyond first name.
- A/B subject-line testing.
- Backfill / catch-up sends for users created before this code shipped (intentional — brief says don't).
- Granular unsubscribe preferences per email_type.

## Build sequence

(See `docs/superpowers/plans/2026-05-07-trial-expiry-emails-plan.md` for the task-by-task breakdown.)

1. Migrations: `trial_emails_sent`, `email_unsubscribes`, `users_in_trial_email_window` RPC, cron schedule.
2. pgTAP test for the RPC.
3. `_shared/unsubscribeToken.ts` + unit tests.
4. `_shared/trialEmailTemplates.ts` + unit tests for all 8 outputs.
5. `unsubscribe-email` edge function + smoke test.
6. `trial-expiry-emails` edge function + happy-path/dedupe tests.
7. `src/pages/Unsubscribe.tsx` + route registration + unit test.
8. `config.toml` `verify_jwt = false` for both functions.
9. Verification (full test/lint/build sweep).
10. Push, PR, CI loop.
