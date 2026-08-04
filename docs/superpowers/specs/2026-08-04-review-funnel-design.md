# Review funnel — QR pages, guest ratings, and a feedback inbox

**Date:** 2026-08-04
**Branch:** `feature/review-funnel`
**Slice:** 1 of 2. Slice 2 (AI summarize, email replies, incentives) is scoped
at the end of this document and is a separate spec.

---

## Problem

A restaurant that wants more Google reviews has no way to ask for one. The
ask has to happen at the table, on the guest's own phone, in the ten seconds
between the check landing and the party standing up — and EasyShiftHQ has no
surface that a guest can reach at all. Every page in the app is behind
`ProtectedRoute` (`src/App.tsx:139`), and the only unauthenticated routes are
auth, password reset, unsubscribe, and OAuth callbacks (`src/App.tsx:307-310`,
`361-364`).

The second half of the problem is what happens when the visit went badly. A
one-star guest who is handed a Google link leaves the one star in public. A
one-star guest who is handed a private form tells the owner what went wrong,
and the owner gets a chance to fix it. Today neither path exists, so the
feedback simply never arrives.

There is also no "reviews" concept anywhere in the permission model. The
roles-and-areas system has exactly fourteen areas
(`supabase/migrations/20260730100000_roles_and_areas_tables.sql:95`, mirrored
in `src/lib/permissions/areas.ts:37`), and none of them covers guest-facing
marketing surfaces.

## What this ships

- A **public page at `/r/:slug`**, unauthenticated: restaurant logo, headline,
  five stars. Tapping a star writes the rating immediately, then routes the
  guest to either the restaurant's Google review link or a private feedback
  form, based on a per-page threshold.
- A **`reviews` permission area** — the fifteenth — with `view` and `manage`
  levels, wired through all eight files the existing fourteen are wired through.
- A **`Reviews` entry** in the Main nav group.
- An admin page at **`/reviews`** with two tabs: *Pages* (list + builder +
  downloadable QR) and *Feedback* (inbox with status).
- One **anonymous edge function**, `review-public`, which is the only thing
  the guest's browser talks to. `anon` gets no table grants at all.

**Out of scope for this slice:** AI summarization of feedback, replying to
guests by email, coupons/incentives, non-Google destinations (Yelp,
TripAdvisor), and per-page analytics beyond the counts shown on the cards.

---

## The threat model, first

This is the first surface in the product an unauthenticated stranger can
write to, so the security shape is decided before the features.

`memory/lessons.md` states the rule this design is built around: for
anonymous users arriving from a public link, *the body itself must contain a
verifiable token; never rely on URL obscurity*. A slug in a URL printed on a
table tent is not a secret — it is photographed, shared, and guessable.

Four consequences:

1. **`anon` gets zero grants on any of the three new tables.** Not "RLS policies that
   happen to be restrictive" — no `GRANT` at all. The guest's browser never
   speaks to PostgREST. Every read and write goes through the edge function,
   which uses the service role and returns only the fields the page renders.
2. **The write is two steps, and the second is token-authorized.** Tapping a
   star creates the row. Submitting the comment *updates* that row, and is
   authorized by a short-lived HMAC token minted in step one — the same
   construction as `supabase/functions/_shared/unsubscribeToken.ts`, which
   already runs unchanged in Deno and Vitest because it uses Web Crypto.
   Without this, `POST` with any UUID would let a stranger overwrite another
   guest's comment.
3. **The token is single-use by construction.** Step two's `UPDATE` carries
   `AND comment IS NULL`. A replayed token updates zero rows and gets the same
   generic success response as a first-time submit.
4. **Rate limiting is per page, per IP hash, per hour, and the ceiling is 120.**
   The IP is never stored raw: `ip_hash = encode(sha256(ip || :pepper), 'hex')`,
   using a dedicated `REVIEW_IP_PEPPER` rather than reusing the signing secret —
   hashing pepper and signing key are different jobs. The ceiling gates **both**
   `rate` and `comment`, because single-use enforcement stops a replayed token
   from corrupting data but does nothing to bound how many times it can be
   thrown at the endpoint.

   **The ceiling is sized for a full restaurant, not for an attacker.** This is
   the one number in the design most likely to be set wrong, and setting it
   wrong is worse than not having it: guest wifi NATs the entire dining room
   behind one public IP, so a per-IP cap tuned for abuse resistance would
   silently discard a busy Friday's real ratings — the exact data the feature
   exists to collect — behind an indistinguishable success response. 120/hour
   comfortably clears a full house turning over on shared wifi while still
   bounding a single source.

   Over the ceiling, the guest gets the ordinary success response — an error
   would tell an abuser to rotate IPs — but the drop is **logged server-side
   with the page id and the hashed IP**. A silent drop the operator cannot see
   is how a throttling misconfiguration survives for months.

A honeypot field (`hp`) is rendered hidden and must arrive empty **on both
`rate` and `comment`**. `rate` is the endpoint a bot hits first and may be the
only one it ever hits, so omitting the check there would leave it off the
request it is most useful against. This is cheap and catches naive
form-fillers; it is not load-bearing.

---

## Data model

### `review_pages`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `restaurant_id` | `uuid` NOT NULL | FK → `restaurants(id)` ON DELETE CASCADE |
| `slug` | `text` NOT NULL | globally unique, see below |
| `name` | `text` NOT NULL | internal label ("Table tents") |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | |
| `logo_path` | `text` NULL | object path in `review-page-logos` |
| `headline` | `text` NOT NULL DEFAULT `'How was everything?'` | |
| `subheadline` | `text` NULL | |
| `promoter_threshold` | `smallint` NOT NULL DEFAULT `4` | `CHECK BETWEEN 1 AND 5` |
| `destination_url` | `text` NULL | `CHECK (destination_url ~ '^https://')` |
| `created_by` | `uuid` NULL | FK → `auth.users(id)` ON DELETE SET NULL |
| `created_at` / `updated_at` | `timestamptz` NOT NULL | `updated_at` via the existing trigger convention |

**Slug is globally unique, not per-restaurant**, because `/r/:slug` is a
global namespace. Enforced by `UNIQUE (slug)` plus
`CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$')`. The builder
generates a slug from the page name, and on collision appends a four-character
random suffix rather than surfacing "that name is taken" — which would
otherwise let anyone probe other tenants' slugs.

**A page with no `destination_url` still works.** Every rating routes to the
feedback form regardless of threshold, and the builder shows this state
plainly rather than silently degrading. That is the correct default for a
restaurant that has not yet found its Google link.

### `review_responses`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL | denormalized; set by trigger, see below |
| `review_page_id` | `uuid` NOT NULL | FK → `review_pages(id)` ON DELETE CASCADE |
| `rating` | `smallint` NOT NULL | `CHECK BETWEEN 1 AND 5` |
| `routed_to` | `text` NOT NULL | `CHECK IN ('destination','feedback')` |
| `comment` | `text` NULL | |
| `contact_consent` | `boolean` NOT NULL DEFAULT `false` | not PII; drives the "can reply" chip |
| `status` | `text` NOT NULL DEFAULT `'new'` | `CHECK IN ('new','in_progress','resolved')` |
| `submitted_at` | `timestamptz` NOT NULL DEFAULT `now()` | the star tap |
| `commented_at` | `timestamptz` NULL | the form submit |
| `ip_hash` | `text` NULL | |

`restaurant_id` is denormalized so RLS can filter without a join, which is how
every other tenant table in this codebase is shaped. It is kept honest by a
`BEFORE INSERT OR UPDATE` trigger that overwrites it from
`review_pages.restaurant_id` — the column cannot be set to a value that
disagrees with the page, even by the service role. The same trigger populates
`review_response_contacts.restaurant_id`.

The trigger function is declared `SECURITY DEFINER SET search_path = public,
pg_temp`, spelled out rather than left to the implementer. This codebase has
rewritten `user_has_capability` six times partly to keep that clause from
going missing, and a new `SECURITY DEFINER` function is not the place to
rediscover why.

### `review_response_contacts`

Guest name and email live in their **own table**, not in `review_responses`:

| Column | Type | Notes |
|---|---|---|
| `review_response_id` | `uuid` PK | FK → `review_responses(id)` ON DELETE CASCADE |
| `restaurant_id` | `uuid` NOT NULL | set by the same trigger |
| `contact_name` | `text` NULL | |
| `contact_email` | `text` NULL | |

This split exists because of a promise the guest page makes in as many words:
*this goes straight to the owner — not public.* Postgres RLS is row-level, so
there is no way to let Chef read a feedback row while withholding the guest's
email from it — and Chef holds `view:reviews` by default, precisely so kitchen
signals reach the kitchen. A second table turns the column-level question into
a row-level one the database can actually answer.

So: **SELECT on `review_response_contacts` requires `manage:reviews`**, while
`view:reviews` is enough to read the rating and the comment. A chef learns the
fries were cold; only an owner or manager learns who to apologise to. The
codebase already separates sensitive fields from area grants this way —
`view:employee_pii` and `view:pay_rates` are independent flags
(`tests/unit/areas.test.ts:108-113`) — and this is the same instinct applied to
guest data.

`contact_consent` stays on `review_responses` because it is not PII: the inbox
needs it to render the "can reply" state for every viewer, and slice 2's reply
feature reads it. When consent is false the edge function **discards** name and
email outright rather than storing them and hiding them, so no row is written
to this table at all.

### Indexes

`(restaurant_id, submitted_at DESC)` for the inbox,
`(review_page_id, ip_hash, submitted_at DESC)` for the rate-limit probe, and
`(restaurant_id, status) WHERE status = 'new'` for the unread badge.

### Storage: `review-page-logos`

A new **public** bucket, 2 MB limit, allowing exactly `image/png`,
`image/jpeg`, and `image/webp`. **SVG is deliberately not allowed** — an SVG
served from a public bucket is a stored-XSS vector. Public because an anonymous
guest's browser has to load the image with no credentials; the content is a
logo the restaurant chose to print on a table tent. Objects are keyed
`{restaurant_id}/{review_page_id}/{uuid}.{ext}`, and writes are restricted to
`manage:reviews` holders for that `restaurant_id`.

**Both restrictions are bucket-level, not dropzone-level.** The `storage.buckets`
row carries `file_size_limit` and `allowed_mime_types` explicitly, and the
INSERT policy additionally checks `storage.extension(name)` against the same
allow-list. Client-side filtering is a courtesy to the uploader; it is not a
control. The writer here is an authenticated tenant admin, and a mislabelled
SVG that slipped through would be served to every guest who scans that QR code
— a blast radius well outside the uploader's own tenant, which is what makes
this worth enforcing twice. The bucket INSERT uses `ON CONFLICT (id) DO NOTHING`
so the migration re-runs safely, matching
`supabase/migrations/20260122000000_create_assets_equipment.sql:123-125`.

Production has four buckets today (`asset-images`, `product-images`,
`receipt-images`, `time-clock-photos`); none has the right visibility and
lifecycle for this, so a fifth is correct rather than overloading
`product-images`.

**No logo is a first-class state, not a broken image.** When `logo_path` is
null the page renders the restaurant's initials in the display face. This
matters because `restaurants` has no logo column at all — verified against
production's `information_schema.columns` — so the *common* case at launch is
no logo.

### RLS

All three tables: `ENABLE ROW LEVEL SECURITY`, and

```sql
REVOKE ALL ON public.review_pages, public.review_responses,
              public.review_response_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_pages TO authenticated;
GRANT SELECT, UPDATE ON public.review_responses TO authenticated;
GRANT SELECT ON public.review_response_contacts TO authenticated;
```

**Each `REVOKE` sits immediately after its own `CREATE TABLE` in the same
migration file**, not collected at the bottom. Production's `pg_default_acl`
grants `anon` full CRUD on newly created public tables automatically, so any
gap between creation and revoke is a window where the table is anon-writable.
Note the revoke names `anon` directly rather than relying on `PUBLIC`, because
that default ACL is a direct grant to the role — the same pattern as
`supabase/migrations/20260802110000_assign_membership_role.sql:210-221`.

Policies resolve through `user_has_capability`
(`supabase/migrations/20260730140000_user_has_capability_from_areas.sql:54`),
exactly as every other tenant table does:

- `review_pages` SELECT → `user_has_capability(restaurant_id, 'view:reviews')`
- `review_pages` INSERT / UPDATE / DELETE → `manage:reviews`
- `review_responses` SELECT → `view:reviews`
- `review_responses` UPDATE → `manage:reviews`
- `review_response_contacts` SELECT → **`manage:reviews`**

Neither `review_responses` nor `review_response_contacts` has an INSERT policy
for `authenticated`, and neither has any grant for `anon`: the only writer is
the edge function's service role. A restaurant cannot manufacture its own
five-star ratings through the API, which is the whole point of the data.

Within each table the read audience matches the write audience — anyone who can
see a row sees it whole. The contact split (above) is what makes that true
without leaking guest email to every `view:reviews` holder.

---

## The `reviews` area — eight files in lockstep

Adding the fifteenth area is the highest-risk part of this work, because the
area catalog is mirrored across eight files and two test suites assert the SQL
and TypeScript copies agree byte-for-byte. All eight change in one commit —
rows 1–4 below are separate edits inside the same new migration.

| # | File | Change |
|---|---|---|
| 1 | `supabase/migrations/…_reviews_area.sql` | `INSERT INTO area_catalog` a `reviews` row, and renumber `sort_order` 7–11 |
| 2 | same migration | `INSERT INTO role_areas` for the builtin roles |
| 3 | same migration | add two rows to `user_has_capability`'s VALUES map (`…20260730140000….sql:205-260`) |
| 4 | same migration | **restate `user_has_capability`'s full signature verbatim** — see below |
| 5 | `src/lib/permissions/types.ts:45` | `'view:reviews' \| 'manage:reviews'` in `Capability` |
| 6 | `src/lib/permissions/areas.ts` | `AreaKey` (`:37`), `AREA_DEFINITIONS` (`:146`), `AREA_CAPABILITIES` (`:254`), `AREA_LANDING_PATHS` (`:391`), `AREA_PRIORITY` (`:414`) |
| 7 | `src/lib/permissions/definitions.ts` | the two capabilities into each builtin role's `ROLE_CAPABILITIES` array |
| 8 | `src/lib/permissions/routeAreas.ts:40` | `{ path: '/reviews', area: 'reviews', minLevel: 'view' }` |
| 9 | `supabase/tests/roles_seed_test.sql` | extend the 78-row fixture and bump `plan()` |
| 10 | `supabase/tests/roles_schema_test.sql:393,398` | `14 → 15` areas, `10 → 11` distinct `ui_group`s |
| 11 | `tests/unit/areas.test.ts:18-53` | add `'reviews'` to `ALL_AREA_KEYS`, `AREA_DEFINITIONS.length` `10 → 11`, and add it to the literal Operations-band array |

Rows 10 and 11 are the ones that bite. Both files hardcode the *count* of areas
rather than deriving it — `roles_schema_test.sql:393` asserts exactly 14 rows in
`area_catalog` and `:398` asserts exactly 10 distinct `ui_group`s;
`areas.test.ts` hardcodes a 14-entry `ALL_AREA_KEYS`, `AREA_DEFINITIONS.length
=== 10`, and the literal
`['reports','sales','inventory','recipes','scheduling']` Operations band. That
is deliberate on their part — the whole point is that adding an area cannot be
done accidentally — but it means four assertions across two suites go red the
moment row 1 lands, in files the rest of this section doesn't otherwise touch.

### The signature restatement is not optional

Row 4 exists because that migration's own header says so
(`…20260730140000….sql:1-14`): the function is on its **6th rewrite**, and each
one MUST restate `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path =
public` in full rather than letting `CREATE OR REPLACE` carry it forward.
Dropping `SET search_path` from a `SECURITY DEFINER` function is a
privilege-escalation vector, and it is exactly the kind of thing that goes
missing when someone edits "just the VALUES map."

### Catalog row and ordering

```sql
('reviews', 'reviews', 'Operations', 6, 'view')
```

Inserting at Operations position 6 pushes `books`/`chart_of_accounts` to 7,
`payroll` to 8, `employees` to 9, `team`/`collaborators` to 10, and
`settings`/`integrations` to 11. **The migration renumbers those rows
explicitly.** `sort_order` drives the editor's row order and, transitively,
`AREA_PRIORITY`'s landing-path resolution — leaving a gap or appending at 15
would put Reviews below Settings in the editor, which reads as an
afterthought.

`max_level_collaborator = 'view'` means an external collaborator can be shown
guest feedback but can never create or edit a public page carrying the
restaurant's name. `role_areas_enforce_collaborator_cap`
(`supabase/migrations/20260730100000_roles_and_areas_tables.sql:527`) enforces
this at write time; no UI change is needed to make it true.

### Builtin grants

| Role | Level | Why |
|---|---|---|
| Owner | `manage` | |
| Manager | `manage` | |
| Operations Manager | `manage` | runs the floor; owns table tents |
| Chef | `view` | "the fries were cold" is a kitchen signal |
| Employee, Kiosk | — | |
| Accountant, Inventory Helper, Recipe Consultant, Ops Manager (collaborator) | — | grantable at `view` per the cap, not granted by default |

### The legacy branch is deliberately not touched

`user_has_capability` has two branches: `role_id IS NOT NULL` resolves from
`role_areas`; `role_id IS NULL` falls through to a legacy role-literal `CASE`
(`…20260730140000….sql:96`) whose header says, verbatim, *do not "clean up" or
reorder branches here.*

That `CASE` will not know `view:reviews` and will return `FALSE` for it. This
is correct and safe, because **no production membership is on that branch**:

```
role                              total  missing_role_id
staff                                76                0
owner                                72                0
kiosk                                 4                0
collaborator_accountant               2                0
collaborator_operations_manager       1                0
chef                                  1                0
manager                               1                0
```

(read-only query against production, 2026-08-04). Every one of the 157
memberships carries a `role_id`. A hypothetical future membership created
without one fails closed on a brand-new feature — the mildest possible failure
mode — and adding cases to a block documented as a verbatim transcription
would break the invariant that block exists to hold.

### Nav consequence, stated rather than discovered

`getNavigationForRole` (`src/components/AppSidebar.nav.ts:299`) returns the
full `navigationGroups` for owner, manager **and chef**, and
`operationsManagerNav` (`:210`) derives from it. So adding one item to the
Main group (`:55-63`) surfaces Reviews for all four. That matches the grants
above — chef holds `view:reviews` — so no new nav-filtering machinery is
introduced.

Internal roles are not route-restricted at all: `StaffRoleChecker`
(`src/App.tsx:260-283`) gates kiosk, staff, and collaborators only. The real
gate for an internal role is RLS plus the page's own
`hasCapability('view:reviews')` check, which renders a permission-denied state
rather than an empty table.

Custom collaborator roles are handled by the `routeAreas.ts` entry: they reach
`/reviews` only by holding the area, since `allowedPathsForAreas`
(`routeAreas.ts:110`) derives their allow-list from `AREA_ROUTES`.

---

## The public page

### Route

`/r/:slug`, declared **outside** `ProtectedRoute`, alongside `/unsubscribe`
(`src/App.tsx:310`).

**This route must be `React.lazy`, and that is a requirement, not a
preference.** Every one of the 40+ routes in `src/App.tsx` is a static import
today — `grep "React.lazy" src/App.tsx` returns nothing — so the path of least
resistance is to add `/r/:slug` the same way as its neighbours and silently
defeat the whole isolation story. The public page pulls in two webfonts and a
Counter stylesheet that no authenticated user will ever render.

Concretely: `const ReviewPage = lazy(() => import('./pages/ReviewPage'))`,
wrapped in a `Suspense` whose fallback is the paper card skeleton (not the
app's spinner — a logged-out guest should never see app chrome). `cssCodeSplit`
is on by default in `vite.config.ts` and is not disabled, so the Counter CSS
follows its chunk correctly once the boundary exists. **Verification is a
`npm run build` output check, not an assumption**: the Zilla Slab/Plex Mono
`@font-face` block and the QR library must appear in a chunk the index route
does not load.

### Aesthetic direction — "Counter"

The page renders under the restaurant's name and is the only part of
EasyShiftHQ a diner ever sees, so it commits to a look the admin screens do
not: **the check presenter**. Warm paper ground, a slab serif for the
question, dashed hairline rules top and bottom, and monospace micro-copy for
the small print. It reads as an extension of the physical table rather than a
web form, which is what gets it finished in ten seconds.

- **Display / body:** Zilla Slab (SIL OFL), self-hosted woff2, Latin subset.
- **Micro-copy:** IBM Plex Mono (SIL OFL), same treatment.
- **Stars:** text glyphs, not images or icon components — one less request on
  restaurant wifi, and they scale with the type.

Both faces are `font-display: swap`, loaded from `/public/fonts` and declared
in a stylesheet imported only by the public route.

The palette is a **smaller delta than it looks**. `src/index.css:6-43` already
defines a warm light theme — `--background: 40 33% 98%`, `--foreground:
30 15% 15%`, `--primary: 16 60% 46%` (burnt orange). Counter is that palette,
slightly deepened. It ships as a `.theme-counter` scope that overrides the
same HSL custom properties, so every class stays semantic
(`bg-background`, `text-foreground`, `border-border`) and no direct colour
appears anywhere. The scope also pins the tokens absolutely rather than
inheriting `.dark` (`src/index.css:81`) — the guest is not logged in, has no
theme preference of ours, and the page is paper in both. Custom properties
declared on the element itself beat an ancestor's inherited value regardless of
specificity, so this works without `!important`.

One dormant caveat: `src/components/ui/alert.tsx` carries a hardcoded
`dark:border-destructive` utility, which is a Tailwind variant rather than a
custom-property reference and so would **not** follow the `.theme-counter`
override if `.dark` ever landed on an ancestor. Nothing applies `.dark` today
(there is no `ThemeProvider` in `src/main.tsx` or `src/App.tsx`), but the
public page's error states should use a plain bordered card rather than
`Alert variant="destructive"` so the question never arises.

### Flow

1. **Land.** Logo (or initials), restaurant name, headline, five stars, and a
   monospace line reading *tap a star — 10 seconds, no account*.
2. **Tap.** The rating is written **immediately**, before anything else is
   shown. A guest who taps two and closes the tab still leaves the two. Only
   the written comment can be abandoned.
3. **At or above `promoter_threshold`** (default 4): a thank-you and a
   **button** to the Google link, plus a visible *No thanks*. **Not an
   auto-redirect.** A page that fires the guest at Google the instant they tap
   five is functionally review-gating; the ask-with-an-out version converts
   slightly worse and stays on the right side of both Google's review policy
   and the FTC's 2024 rule on suppressing negative reviews. The outbound link
   carries `rel="noopener noreferrer"`.
4. **Below threshold:** a private form — required comment, optional name and
   email behind a consent checkbox, with the copy *this goes straight to the
   owner — not public*.
5. **Done.** A confirmation for both branches.

Steps 2–5 are client state within one route; no navigation, so a back button
never resurrects a half-submitted form.

### States

- **Loading:** the paper card with a skeleton in place of name and stars.
- **Unknown or inactive slug:** a neutral "this link isn't active" card in the
  same aesthetic. Not a redirect to the app's `NotFound`, which would show a
  logged-out stranger EasyShiftHQ chrome, and not a 404-flavoured message that
  distinguishes "never existed" from "paused".
- **Submit failure:** an inline retry on the form. The rating is already
  saved at this point, and the copy says so.
- **Offline / slow:** the star tap optimistically advances the UI and
  reconciles. If the `rate` call never completes, the client **does not know
  which branch this guest belongs in** — `routed_to` is computed server-side and
  never arrived. It therefore falls back to the **plain thank-you with no
  call to action at all**: no Google button, no feedback form. Guessing wrong in
  the promoter direction would hand a Google review link to a guest who may have
  tapped one star, which is the single worst outcome this feature can produce.
  The generous-looking fallback is the unsafe one.

---

## The edge function

One function, `review-public`, with `verify_jwt = false` in
`supabase/config.toml` — one entry, one anonymous surface, following
`accept-invitation` (`:35`) and `validate-invitation` (`:38`). CORS via
`_shared/cors.ts`.

Three actions on `POST`:

| Action | Body | Returns |
|---|---|---|
| `page` | `{ slug }` | `{ restaurant_name, headline, subheadline, logo_url, threshold }` — nothing else. No ids, no `destination_url`. |
| `rate` | `{ slug, rating }` | `{ token, routed_to, destination_url? }` — the Google URL is released only when `routed_to = 'destination'`. |
| `comment` | `{ token, comment, name?, email?, consent?, hp? }` | `{ ok: true }` |

`rate` computes `routed_to` **server-side** from the page's threshold. The
client is never trusted with the branch, so a crafted request cannot file a
one-star response as a promoter or extract the Google URL for a low rating.

The token payload is `{ rid, exp }` signed with `REVIEW_TOKEN_SECRET`. `exp` is
30 minutes. Verification reuses the shape of `verifyUnsubscribe`, including its
constant-time comparison. Note that the existing `UnsubPayload` has no `exp`
field — this reuses the *mechanism*, not the type.

Two new edge-function secrets must be set before deploy, and they are the only
new configuration this feature needs: `REVIEW_TOKEN_SECRET` for signing, and
`REVIEW_IP_PEPPER` for the `ip_hash`. Keeping them separate costs nothing and
avoids a signing key doing double duty as a hashing pepper.

`comment` writes name and email to `review_response_contacts` only when consent
is true; otherwise it discards them and writes no contacts row.

Failure responses are generic 4xx/5xx strings with no internal detail, per the
codebase's existing rule. `comment` returns the same `{ ok: true }` for a
successful update, a replayed token, and a rate-limited drop.

---

## The admin surfaces

`/reviews`, one route, one nav entry, two Apple/Notion underline tabs
(`CLAUDE.md`'s tab pattern). Everything below is standard house style —
semantic tokens, the documented type scale, `border-border/40`,
`rounded-xl` cards.

**Both tabs are two-pane on desktop and drill-in on mobile.** Below `md`, the
detail pane is not a squeezed column and not a modal — the list fills the
viewport, tapping a row replaces it with the detail view, and a back control
returns. A manager checking feedback from a phone between covers is a real
user, and the alternative (a fixed two-column DOM retrofitted later) is the
kind of structure that resists being changed once tests are written against it.
The selected item is component state either way; only the layout branches.

Choosing one route over two nav entries keeps the permission story to a single
`AREA_ROUTES` row. Folding the inbox into the existing `/ops-inbox` was
considered and rejected: `useOpsInbox`'s item kinds are all financial signals
(`src/pages/OpsInbox.tsx:33-39` — uncategorized txn/POS, anomaly,
reconciliation, recommendation), and guest feedback shares no fields, no
priority semantics, and no resolution path with them.

### Pages tab

Left: a card per page — name, `Live`/`Paused` chip, slug, average rating,
rating count, comment count. Right: the builder panel — name, slug (with the
full public URL shown), a 1–5 threshold control, the Google review URL, logo
upload, and the QR block.

Rating counts and averages come from a single aggregate query per restaurant,
not per card.

The Pages tab needs all three states in its own right, not by inheritance from
the Feedback tab: `Skeleton` cards while loading, an error state, and — the one
that actually matters — a real empty state, because **every existing restaurant
starts here with zero pages.** That empty state is the feature's front door:
what a QR review page is, and a single button to create the first one.

The threshold control is a **radio group styled as a star scale**, not an
`<input type=range>`: five discrete values, each needing its own accessible
name ("send to Google at 4 stars or above"). A slider with five stops is worse
for both keyboard and screen-reader users.

Selection-follows-focus is *correct* here, unlike on the guest page — this is
an ordinary radio group, and an intermediate value costs a settings write, not
a branch a guest lives through. The builder saves on an explicit **Save**, not
on change, so arrowing from 1 to 5 fires no intermediate requests.

### QR

Generated **client-side** from the public URL. This needs a new dependency —
`package.json:99` has `html5-qrcode`, which is a *scanner*. The proposal is
`qrcode` (MIT), dynamically imported inside the builder so it never enters the
main chunk; it produces both an SVG string (for print) and a canvas data URL
(for PNG).

**The QR encodes the slug**, so a reprinted table tent survives a page rename,
and retiring a page means pausing it — never a reprint. Downloads are named
`{slug}-qr.svg` / `.png`.

### Feedback tab

Header metrics: average rating, total ratings, comment count, unread count.
Then a master list and a detail panel.

**Only responses with a comment appear in the list.** Ratings without comments
still count toward every metric above. A page that collects 300 taps and 50
comments has an inbox of 50 rows, not 300 mostly-empty ones.

Rows: star rating, `New`/`In progress`/`Resolved` chip, source page, relative
time, name-or-*anonymous*, and a two-line comment excerpt. Detail: full
comment, received timestamp **in the restaurant's timezone** (per the
convention established in `61e73fec`), the contact block, and the status
control.

**The contact block renders only for `manage:reviews` holders**, because
`review_response_contacts` is unreadable to anyone else — a `view:reviews`
viewer such as Chef sees the rating, the comment, and a "guest left contact
details" state, but not the name or address. Every row shows *anonymous* in the
list for that viewer. This is enforced by RLS, so the UI is reflecting a fact
rather than deciding one.

Standard states throughout: `Skeleton` while loading, an error state, and a
real empty state — for the inbox, one that says feedback arrives here once a
page is live, with a link to the Pages tab.

React Query with `staleTime: 30000` and `refetchOnWindowFocus`, matching the
codebase convention. No manual caching.

### Hooks

Business logic lives in `src/hooks/useReviewPages.ts` and
`src/hooks/useReviewResponses.ts`, and pure helpers (slug generation,
threshold labelling, response aggregation) in `src/lib/reviews/`. This is
deliberate: `src/components` is excluded from coverage measurement, `src/lib`
and `src/hooks` are not.

Every client-side mutation carries an explicit `.eq('restaurant_id', …)`
alongside the row id, per the standing rule — RLS is the second lock, not the
first. `src/hooks/useCheckBankAccounts.ts:82-84` is the convention to copy
verbatim: `.update(rest).eq('id', id).eq('restaurant_id', restaurantId)`, with
an early `if (!restaurantId) throw` guard above it (`:110`).

---

## Testing

**pgTAP** (`supabase/tests/`)

- `review_pages_rls_test.sql` — a `view:reviews` holder reads but cannot
  insert; a `manage:reviews` holder can; a member of another restaurant sees
  nothing; `anon` has no grant.
- `review_response_contacts_rls_test.sql` — the finding this table exists to
  answer: a `view:reviews` holder (Chef) can read the parent response row and
  **cannot** read its contacts row; a `manage:reviews` holder can read both; a
  member of another restaurant reads neither. Also asserts no INSERT policy
  exists for `authenticated`.
- `review_responses_rls_test.sql` — `authenticated` cannot INSERT at all; the
  `restaurant_id` trigger overwrites a mismatched value; the status CHECK and
  the rating CHECK reject out-of-range values.
- `roles_seed_test.sql` — extended fixture: the fifteen-area catalog still
  round-trips byte-for-byte against `ROLE_CAPABILITIES` for all ten builtin
  roles, in both directions.
- `reviews_area_catalog_test.sql` — `sort_order` is contiguous 1..11 after
  the renumber, and `reviews` caps collaborators at `view`.

**Vitest** (`tests/unit/`)

- `reviewToken.test.ts` — sign/verify round trip, tampered payload rejected,
  tampered signature rejected, expired token rejected, wrong-secret rejected.
- `reviewRouting.test.ts` — threshold boundary table for every
  `(rating, threshold)` pair in 1..5 × 1..5, plus the no-`destination_url`
  case routing everything to feedback.
- `reviewSlug.test.ts` — generation, charset clamping, collision suffix.
- `reviewRateLimit.test.ts` — the ceiling counts within the window and not
  outside it; at 119 the write lands, at 121 it drops; the drop returns the
  same shape as a success; a drop emits a server-side log line. The
  full-restaurant case is the one that matters: 120 distinct ratings from one
  `ip_hash` inside an hour all persist.
- `areas.test.ts`, `routeAreas.test.ts`, `permissions.test.ts`,
  `AppSidebar.nav.test.ts` — existing suites, extended for the new area.

**Playwright** (`tests/e2e/`)

- `review-stars.spec.ts` — the keyboard path the critical a11y decision exists
  to protect: focus the radiogroup, press → four times, assert **no** network
  write has fired and star 5 is previewed; press `Enter`, assert exactly one
  write with `rating: 5`. This is the regression test for
  selection-follows-focus creeping back in.
- `review-funnel.spec.ts` — an owner creates a page; an unauthenticated
  context visits `/r/:slug`, taps 5, and lands on the Google prompt (link
  asserted, not followed); a second context taps 2, submits a comment; the
  owner sees exactly one row in the inbox and marks it resolved. Uses
  `generateTestUser()` and `getByRole`/`getByLabel` selectors per the
  house pattern.

---

## Accessibility

The public page is the strict case: it is used one-handed, in low light, by
someone who did not choose to be there.

- The star control is a **radiogroup**, not five buttons. Each star has an
  accessible name ("2 out of 5 stars"), arrow keys move between them, and the
  group has a visible focus ring that survives the paper background.

- **Focus movement previews; only an explicit commit submits.** This is the one
  place the design deliberately departs from the ARIA radio pattern, and it has
  to, because three otherwise-correct decisions collide: the ARIA APG radio
  pattern makes arrow keys *check* the newly-focused radio ("selection follows
  focus"), the rating is written the instant it is selected, and selection moves
  focus to the next branch's heading. Composed naively, a keyboard user pressing
  → once from star 1 would file a 2, be branched on it, and have focus yanked
  out of the radiogroup — making stars 3–5 unreachable and filing the wrong
  rating on the first keystroke.

  So: arrow keys move a **roving tabindex** and update `aria-checked` for
  preview only. The write fires on `Enter`/`Space`, or on click/tap. A mouse or
  touch guest is unaffected either way, since a tap names its value directly.
  `Radix RadioGroup` implements selection-follows-focus and therefore cannot be
  used as-is here; this is a custom control built on the primitive's
  keyboard/roving-focus behaviour with the commit decoupled.

- The rating is announced on selection via a polite live region, because the
  visual confirmation (colour fill) is not available to everyone. Preview
  changes announce the star value; the commit announces the branch.
- Branch transitions move focus to the new heading; the feedback form's
  textarea is labelled, not placeholder-only.
- Contrast is checked at AA for body copy against the paper ground, including
  the muted micro-copy, which is the tone most likely to fail. This is a
  **gate, not an assertion**: the `.theme-counter` values for
  `--muted-foreground` against `--background` get a computed ratio once the
  exact HSL triples are chosen, and the micro-copy tone moves darker if it
  misses. A page read in daylight on a phone has no margin for a stylish grey.
- The honeypot is `aria-hidden` with `tabindex="-1"` so assistive tech never
  offers it.
- Admin side: the QR download buttons carry `aria-label`s naming the format,
  and status chips are not colour-only — each carries its text.

---

## Slice 2 (not this PR)

Deliberately deferred, with the hooks for each already in the slice-1 schema:

- **Summarize** — an `ai-caller` (`_shared/ai-caller.ts`) pass over a period's
  comments. Nothing in slice 1 blocks it.
- **Reply by email** — via `_shared/emailQueue.ts`'s `sendPaced`. Depends on
  `contact_email` + `contact_consent`, both captured now.
- **Incentives / coupons** — a message and code shown at or above a second
  threshold. Hangs off the same star-tap write.

Shipping a working inbox without a disabled *Reply* button is the point: the
consent flag exists now so the reply feature has something to stand on when it
lands.
