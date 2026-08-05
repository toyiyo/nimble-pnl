# Review Funnel (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the review funnel's first slice — a `reviews` permission area, an admin page builder that mints QR codes, a public star-rating landing page that routes promoters to Google and everyone else to a private feedback form, and a feedback inbox.

**Architecture:** Guests never touch PostgREST. The public page (`/r/:slug`, a lazy route) talks only to one `verify_jwt = false` edge function, `review-public`, which holds the service-role key and computes the promoter/feedback branch server-side. Writes are two-step: `rate` inserts the response row and returns an HMAC token; `comment` updates that row, authorized by the token and single-use via `AND comment IS NULL`. Guest contact PII lives in its own table (`review_response_contacts`) because Postgres RLS is row-level, not column-level — that is the only way `view:reviews` can read feedback without reading email addresses. Admin surfaces are ordinary React Query hooks over RLS-protected tables.

**Tech Stack:** React 18.3 + TypeScript + Vite + TailwindCSS + shadcn/ui, React Router 6, React Query, Supabase (Postgres + RLS + Storage + Deno edge functions), Vitest / Playwright / pgTAP, `qrcode` (new dependency), `@fontsource/zilla-slab` + `@fontsource/ibm-plex-mono` (new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-04-review-funnel-design.md` (committed at `1118f58b`).

## Global Constraints

- **`anon` gets zero grants on all three new tables.** `pg_default_acl` on production grants `anon` full CRUD on newly created public tables automatically, so each `REVOKE ALL ... FROM anon` must sit **immediately after its own `CREATE TABLE`**, not batched at the end of the migration.
- **The guest browser only ever calls the `review-public` edge function.** No `supabase.from(...)` on the public page, ever.
- **`routed_to` is computed server-side.** `destination_url` is released to the guest only when `routed_to = 'destination'`.
- **Rate limit: 120 requests/hour per `(review_page_id, ip_hash)`**, gating **both** `rate` and `comment`. `ip_hash = encode(sha256(ip || :pepper), 'hex')` with a dedicated `REVIEW_IP_PEPPER`. Over-limit returns the ordinary success-shaped response but logs server-side with page id + hashed IP.
- **Honeypot field `hp` must arrive empty on both `rate` and `comment`.** A non-empty `hp` gets the same silent success-shaped response.
- **Token payload is `{ rid, exp }`**, `exp` = 30 minutes out, signed HMAC-SHA256 with `REVIEW_TOKEN_SECRET`. It reuses the *mechanism* of `supabase/functions/_shared/unsubscribeToken.ts`, not its type — `UnsubPayload` has no `exp`.
- **Every `SECURITY DEFINER` function carries `SET search_path = public, pg_temp`.**
- **Error strings returned to guests are generic.** Never echo Postgres errors, never distinguish "page not found" from "page disabled".
- **Semantic tokens only.** No `bg-white`, no `text-black`, no hex colors outside the `.theme-counter` CSS variable block.
- **No manual caching.** React Query only, `staleTime: 30000`, `refetchOnWindowFocus: true`.
- **All user-visible dates render in the restaurant's timezone** via `useRestaurantClock()`. The ESLint guardrail in `eslint.config.js` bans `format(x, 'yyyy-MM-dd')`, `toLocale*String`, `.toISOString().split('T')[0]`, and `Intl.DateTimeFormat().resolvedOptions()` across `src/**`. **Do not add any new file to the allowlist at `eslint.config.js:220-234`.**
- **Every client-side multi-tenant mutation carries an explicit `.eq('restaurant_id', restaurantId)`** in addition to `.eq('id', id)`.
- **Never `git add -A`, `git add .`, or `git commit -a`.** Stage explicit paths.

## Deviations from the spec's letter

Two places where this plan implements the spec's intent with different mechanics. Both are deliberate:

1. **Fonts.** The spec says hand-place woff2 files in `/public/fonts`. This plan uses `@fontsource/zilla-slab` and `@fontsource/ibm-plex-mono` imported from the lazy `ReviewPage.tsx` instead. Same outcome — self-hosted latin subset, no third-party network request — but deterministic and installable by `npm ci`.
2. **Trigger functions.** The spec says "the same trigger" backfills `restaurant_id` on both child tables. This plan writes **two** `SECURITY DEFINER` trigger functions, one per table, because they read different parent tables (`review_pages` vs `review_responses`).

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260804100000_reviews_area.sql` | `reviews` area catalog row, builtin grants, capability map rows |
| `supabase/migrations/20260804100100_review_funnel_tables.sql` | Three tables, RLS, indexes, storage bucket |
| `supabase/tests/reviews_area_catalog_test.sql` | pgTAP: catalog shape + `user_has_capability` for the new area |
| `supabase/tests/review_pages_rls_test.sql` | pgTAP: `review_pages` RLS |
| `supabase/tests/review_responses_rls_test.sql` | pgTAP: `review_responses` RLS |
| `supabase/tests/review_response_contacts_rls_test.sql` | pgTAP: contact-PII isolation |
| `supabase/functions/_shared/reviewToken.ts` | HMAC token mint/verify with expiry |
| `supabase/functions/_shared/reviewRouting.ts` | `routeRating` — the promoter/feedback branch |
| `supabase/functions/_shared/reviewRateLimit.ts` | IP hashing + over-limit predicate |
| `supabase/functions/review-public/index.ts` | The only endpoint the guest browser talks to |
| `src/lib/reviews/reviewSlug.ts` | Slug generation and validation |
| `src/lib/reviews/reviewMetrics.ts` | Response aggregation for the Feedback header |
| `src/lib/reviews/relativeTime.ts` | Coarse "how long ago" for inbox rows |
| `src/pages/ReviewPage.tsx` | The public landing page (lazy route) |
| `src/components/reviews/StarRating.tsx` | Roving-tabindex radiogroup star control |
| `src/components/reviews/ReviewPageBuilder.tsx` | The right-hand builder pane: create/edit one review page |
| `src/components/reviews/ReviewQrDialog.tsx` | QR render + SVG/PNG download (dynamic `qrcode` import) |
| `src/components/reviews/ReviewFeedbackDetail.tsx` | One response, expanded |
| `src/hooks/useReviewPages.ts` | React Query CRUD over `review_pages` |
| `src/hooks/useReviewResponses.ts` | React Query read over `review_responses` |
| `src/pages/Reviews.tsx` | `/reviews` — Pages tab + Feedback tab |
| `src/styles/counter-theme.css` | `.theme-counter` variable scope |
| `tests/unit/reviewToken.test.ts`, `reviewRouting.test.ts`, `reviewRateLimit.test.ts`, `reviewSlug.test.ts`, `reviewMetrics.test.ts`, `relativeTime.test.ts` | Vitest |
| `tests/e2e/review-stars.spec.ts`, `tests/e2e/review-funnel.spec.ts` | Playwright |

**Modified:** `src/lib/permissions/types.ts`, `areas.ts`, `definitions.ts`, `routeAreas.ts`, `tests/unit/areas.test.ts`, `supabase/tests/roles_schema_test.sql`, `supabase/tests/roles_seed_test.sql`, `src/App.tsx`, `src/components/AppSidebar.nav.ts`, `supabase/config.toml`, `package.json`.

---
## Task 1: The `reviews` area, in lockstep

A new area is only real when eight files agree: the SQL catalog, the builtin seed, the capability map, the two pgTAP suites that count areas, and the four TypeScript files that mirror them. Splitting this across tasks leaves the repo in a state where `npm run test` fails, so it is one task and one commit.

**Files:**
- Create: `supabase/migrations/20260804100000_reviews_area.sql`
- Create: `supabase/tests/reviews_area_catalog_test.sql`
- Modify: `supabase/tests/roles_schema_test.sql:392` and `:399`
- Modify: `supabase/tests/roles_seed_test.sql:124` (fixture 1 tail), `:190`, `:241`, `:274`, `:294` (fixture 2)
- Modify: `src/lib/permissions/types.ts` (add two capabilities)
- Modify: `src/lib/permissions/areas.ts` (`AreaKey`, `AREA_DEFINITIONS`, `AREA_CAPABILITIES`, `AREA_LANDING_PATHS`, `AREA_PRIORITY`)
- Modify: `src/lib/permissions/definitions.ts` (four roles)
- Modify: `src/lib/permissions/routeAreas.ts` (`AREA_ROUTES`)
- Modify: `tests/unit/areas.test.ts`

**Interfaces:**
- Consumes: nothing — this is the first task.
- Produces: `AreaKey` gains `'reviews'`; `Capability` gains `'view:reviews'` and `'manage:reviews'`; SQL `user_has_capability(restaurant_id, 'view:reviews' | 'manage:reviews')` returns TRUE for the seeded roles. Every later task depends on these exact strings.

- [ ] **Step 1: Write the failing pgTAP catalog test**

Create `supabase/tests/reviews_area_catalog_test.sql`:

```sql
-- Verifies the `reviews` area exists, sits where the design puts it, and that
-- user_has_capability resolves its two capabilities from role_areas. Roles are
-- addressed by role_id (not the legacy `role` string) because the legacy CASE
-- branch has no `reviews` arm and returns FALSE by design.
BEGIN;
SELECT plan(9);

-- ---------------------------------------------------------------------------
-- Catalog shape
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.area_catalog WHERE area_key = 'reviews'),
  1,
  'area_catalog holds exactly one reviews row'
);

SELECT is(
  (SELECT band FROM public.area_catalog WHERE area_key = 'reviews'),
  'Operations',
  'reviews sits in the Operations band'
);

SELECT is(
  (SELECT sort_order FROM public.area_catalog WHERE area_key = 'reviews'),
  6,
  'reviews sorts sixth, immediately after scheduling'
);

SELECT is(
  (SELECT max_level_collaborator FROM public.area_catalog WHERE area_key = 'reviews'),
  'view',
  'collaborators may hold reviews at view only'
);

SELECT is(
  (SELECT count(DISTINCT sort_order)::int FROM public.area_catalog),
  (SELECT count(*)::int FROM public.area_catalog),
  'the renumber left every sort_order distinct'
);

-- ---------------------------------------------------------------------------
-- Builtin grants
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT level FROM public.role_areas
   WHERE role_id = 'b0000000-0000-0000-0000-000000000001' AND area_key = 'reviews'),
  'manage',
  'Owner manages reviews'
);

SELECT is(
  (SELECT level FROM public.role_areas
   WHERE role_id = 'b0000000-0000-0000-0000-000000000004' AND area_key = 'reviews'),
  'view',
  'Chef views reviews'
);

SELECT is(
  (SELECT count(*)::int FROM public.role_areas ra
   JOIN public.roles r ON r.id = ra.role_id
   WHERE ra.area_key = 'reviews' AND r.is_builtin),
  4,
  'exactly four builtins hold reviews (Owner, Manager, Operations Manager, Chef)'
);

-- ---------------------------------------------------------------------------
-- Capability resolution: a Chef holds view but not manage
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE reviews_probe AS
SELECT
  EXISTS (
    SELECT 1 FROM (VALUES ('b0000000-0000-0000-0000-000000000004')) v(rid)
    JOIN public.role_areas ra
      ON ra.role_id = v.rid::uuid AND ra.area_key = 'reviews' AND ra.level = 'manage'
  ) AS chef_manages;

SELECT is(
  (SELECT chef_manages FROM reviews_probe),
  FALSE,
  'Chef does not manage reviews'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:db 2>&1 | tail -40
```

Expected: `reviews_area_catalog_test.sql` fails — `area_catalog holds exactly one reviews row` reports `have: 0`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260804100000_reviews_area.sql`:

```sql
-- ============================================================================
-- The `reviews` area.
--
-- Slots into the Operations band at sort_order 6, immediately after
-- scheduling, pushing books/payroll/employees/team/settings down one. No
-- unique constraint exists on area_catalog.sort_order, so the renumber can be
-- a single UPDATE without a deferred-constraint dance.
--
-- Unlike the four split areas (purchasing, chart_of_accounts, collaborators,
-- integrations), `reviews` is its own ui_group: the editor renders one control
-- for it.
-- ============================================================================

UPDATE public.area_catalog
SET sort_order = sort_order + 1
WHERE sort_order >= 6;

INSERT INTO public.area_catalog (area_key, ui_group, band, sort_order, max_level_collaborator)
VALUES ('reviews', 'reviews', 'Operations', 6, 'view');

-- Builtin grants. role_areas_block_builtin_mutation fires BEFORE UPDATE OR
-- DELETE only, so INSERTing builtin rows is permitted; and
-- role_areas_enforce_collaborator_cap returns NEW immediately for builtins.
INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'reviews', 'manage'),  -- Owner
  ('b0000000-0000-0000-0000-000000000002', 'reviews', 'manage'),  -- Manager
  ('b0000000-0000-0000-0000-000000000003', 'reviews', 'manage'),  -- Operations Manager
  ('b0000000-0000-0000-0000-000000000004', 'reviews', 'view');    -- Chef
-- Employee, Kiosk, and all four collaborator builtins get nothing.
```

- [ ] **Step 4: Extend `user_has_capability`'s VALUES map**

The function is a single `CREATE OR REPLACE`; adding capabilities means restating it whole. Append it to `20260804100000_reviews_area.sql` by copying `supabase/migrations/20260730140000_user_has_capability_from_areas.sql` lines **54–281 verbatim** (from `CREATE OR REPLACE FUNCTION public.user_has_capability(` through the closing `$$;`), then make exactly one edit to the copy: change the line that currently reads

```sql
    ('manage:integrations',         'integrations',      'manage')
```

to

```sql
    ('manage:integrations',         'integrations',      'manage'),
    ('view:reviews',                'reviews',           'view'),
    ('manage:reviews',              'reviews',           'manage')
```

Do not touch the legacy `CASE` branch guarded by `IF v_role_id IS NULL THEN` — it carries a "Do not 'clean up' or reorder branches here" comment and has no `reviews` arm on purpose: a member whose row has no `role_id` predates areas and cannot hold this capability.

Then add the trailing comment refresh:

```sql
COMMENT ON COLUMN public.area_catalog.area_key IS
'Stable key joined by role_areas and by user_has_capability''s VALUES map. Fifteen keys collapse onto eleven ui_groups.';
```

- [ ] **Step 5: Reset the database and re-run the pgTAP suite**

```bash
npm run db:reset && npm run test:db 2>&1 | tail -40
```

Expected: `reviews_area_catalog_test.sql` passes all 9. `roles_schema_test.sql` now **fails** two assertions (`14` vs actual `15`, `10` vs actual `11`) — that is the next step.

- [ ] **Step 6: Update the two counting assertions in `roles_schema_test.sql`**

At `supabase/tests/roles_schema_test.sql:392`, change `14,` to `15,` and the description to `'area_catalog holds fifteen areas'`. At `:399`, change `10,` to `11,` and the description to `'the fifteen areas collapse onto the eleven ui_groups of the approved design'`. Update the section comment at `:385-389` so "fourteen areas collapsing onto the ten ui_groups" reads "fifteen areas collapsing onto the eleven ui_groups".

- [ ] **Step 7: Extend the two `roles_seed_test.sql` fixtures**

Fixture 1 (`test_area_capability_at_level`, 78 → 81 rows). Change line 124 from

```sql
  ('integrations', 'manage', 'manage:integrations');
```

to

```sql
  ('integrations', 'manage', 'manage:integrations'),
  ('reviews', 'view', 'view:reviews'),
  ('reviews', 'manage', 'view:reviews'),
  ('reviews', 'manage', 'manage:reviews');
```

Fixture 2 (`test_expected_capabilities`, 226 → 233 rows). Insert after `:190` (`('Owner', 'manage:collaborators'),`):

```sql
  ('Owner', 'view:reviews'),
  ('Owner', 'manage:reviews'),
```

after `:241` (`('Manager', 'manage:collaborators'),`):

```sql
  ('Manager', 'view:reviews'),
  ('Manager', 'manage:reviews'),
```

after `:274` (`('Operations Manager', 'view:settings'),`):

```sql
  ('Operations Manager', 'view:reviews'),
  ('Operations Manager', 'manage:reviews'),
```

and after `:294` (`('Chef', 'view:settings'),`):

```sql
  ('Chef', 'view:reviews'),
```

Mind the terminating punctuation: the last row of the whole `VALUES` list ends with `;`, every other row with `,`. `:294` is mid-list, so the existing comma stays and the new Chef row inherits whatever punctuation `:294` had.

Also update the fixture header comments: "78 rows" → "81 rows", "(226 rows across 9 roles" → "(233 rows across 9 roles".

`SELECT plan(25);` is unchanged — no assertion in this file counts fixture rows.

- [ ] **Step 8: Re-run pgTAP, all green**

```bash
npm run test:db 2>&1 | tail -20
```

Expected: every suite passes.

- [ ] **Step 9: Write the failing TypeScript test**

In `tests/unit/areas.test.ts`, add `'reviews'` to `ALL_AREA_KEYS` after `'scheduling'` (line 23), change `expect(AREA_DEFINITIONS.length).toBe(10)` to `toBe(11)` and its description to `'defines exactly eleven areas'`, and update the Operations band assertion at `:51`:

```typescript
    expect(byBand.get('Operations')).toEqual(['reports', 'sales', 'inventory', 'recipes', 'scheduling', 'reviews']);
```

Add `reviews: 'manage'` to the Owner, Manager, and Operations Manager grant objects and `reviews: 'view'` to the Chef grant object in the per-role reconstruction suite (`:145-187`).

Add one new case to the `AREA_DEFINITIONS` describe block:

```typescript
  it('caps Reviews at view for collaborators', () => {
    const reviews = AREA_DEFINITIONS.find((a) => a.key === 'reviews');
    expect(reviews?.maxLevelForCollaborator).toBe('view');
  });
```

- [ ] **Step 10: Run it and watch it fail**

```bash
npx vitest run tests/unit/areas.test.ts 2>&1 | tail -30
```

Expected: FAIL — `expected 10 to be 11`, plus type errors on `reviews` not being an `AreaKey`.

- [ ] **Step 11: Add the two capabilities to `types.ts`**

In `src/lib/permissions/types.ts`, insert immediately after `| 'manage:collaborators'` and before the sensitive-data-flags comment block:

```typescript
  | 'view:collaborators'
  | 'manage:collaborators'

  // Reviews (public review funnel: pages, QR codes, guest feedback)
  | 'view:reviews'
  | 'manage:reviews'
```

- [ ] **Step 12: Add the area to `areas.ts`**

Add `| 'reviews'` to the `AreaKey` union after `'scheduling'`.

Insert into `AREA_DEFINITIONS` between the `scheduling` and `books` rows, and renumber the five rows below it (`books` 6→7, `payroll` 7→8, `employees` 8→9, `team` 9→10, `settings` 10→11):

```typescript
  { key: 'reviews', label: 'Reviews', band: 'Operations', sortOrder: 6, areaKeys: ['reviews'], maxLevelForCollaborator: 'view' },
```

Add to `AREA_CAPABILITIES`:

```typescript
  reviews: {
    view: ['view:reviews'],
    manageAdds: ['manage:reviews'],
  },
```

Add to `AREA_LANDING_PATHS`:

```typescript
  reviews: '/reviews',
```

Add `'reviews'` to `AREA_PRIORITY` immediately after `'scheduling'`, preserving band order.

- [ ] **Step 13: Grant the capability to the four builtin roles in `definitions.ts`**

In `src/lib/permissions/definitions.ts`, append to `ROLE_CAPABILITIES.owner`:

```typescript
  'view:reviews',
  'manage:reviews',
```

the same two to `manager` and to `operations_manager`, and to `chef`:

```typescript
  'view:reviews',
```

`staff`, `kiosk`, and all four collaborator roles are unchanged.

- [ ] **Step 14: Register the route's area in `routeAreas.ts`**

In `src/lib/permissions/routeAreas.ts`, add to `AREA_ROUTES` after the `/scheduling` entry:

```typescript
  { path: '/reviews', area: 'reviews', minLevel: 'view' },
```

Leave `UNIVERSAL_PATHS` and `COLLABORATOR_PATH_EXCLUSIONS` alone: `/reviews` is neither universal nor excluded from collaborators — a collaborator simply needs the grant.

- [ ] **Step 15: Run the unit tests and the type checker**

```bash
npx vitest run tests/unit/areas.test.ts && npm run typecheck
```

Expected: all `areas.test.ts` cases pass; `tsc --noEmit` is clean. The reconstruction cases prove the TypeScript mirror and the SQL seed grant the same set.

- [ ] **Step 16: Commit**

```bash
git add supabase/migrations/20260804100000_reviews_area.sql supabase/tests/reviews_area_catalog_test.sql supabase/tests/roles_schema_test.sql supabase/tests/roles_seed_test.sql src/lib/permissions/types.ts src/lib/permissions/areas.ts src/lib/permissions/definitions.ts src/lib/permissions/routeAreas.ts tests/unit/areas.test.ts
git commit -m "feat(reviews): add the reviews permission area across SQL and TypeScript"
```

---
## Task 2: Schema, RLS, and the logo bucket

**Files:**
- Create: `supabase/migrations/20260804100100_review_funnel_tables.sql`
- Create: `supabase/tests/review_pages_rls_test.sql`
- Create: `supabase/tests/review_responses_rls_test.sql`
- Create: `supabase/tests/review_response_contacts_rls_test.sql`

**Interfaces:**
- Consumes: `user_has_capability(uuid, text)` with the `'view:reviews'` / `'manage:reviews'` arms from Task 1.
- Produces: tables `public.review_pages`, `public.review_responses`, `public.review_response_contacts` with the columns listed below, and storage bucket `review-page-logos`. Tasks 4, 7, 8, and 9 read these column names verbatim.

- [ ] **Step 1: Write the migration — `review_pages`**

Create `supabase/migrations/20260804100100_review_funnel_tables.sql` starting with:

```sql
-- ============================================================================
-- Review funnel, slice 1: pages, responses, and guest contact PII.
--
-- Each REVOKE sits immediately after its own CREATE TABLE. Production's
-- pg_default_acl grants `anon` full CRUD on newly created public tables, so
-- any gap between creation and revoke is a window in which the table is
-- anon-writable. The revoke names `anon` directly rather than PUBLIC, because
-- that default ACL is a direct grant to the role.
-- ============================================================================

CREATE TABLE public.review_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  logo_path TEXT NULL,
  headline TEXT NOT NULL DEFAULT 'How was everything?',
  subheadline TEXT NULL,
  promoter_threshold SMALLINT NOT NULL DEFAULT 4
    CHECK (promoter_threshold BETWEEN 1 AND 5),
  destination_url TEXT NULL CHECK (destination_url ~ '^https://'),
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON public.review_pages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_pages TO authenticated;
ALTER TABLE public.review_pages ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.review_pages.slug IS
'Globally unique, not per-restaurant: /r/:slug is a global namespace. The builder appends a random suffix on collision rather than reporting the collision, so slugs cannot be probed across tenants.';
```

The slug is globally unique because `/r/:slug` is a global namespace; the `CHECK` bounds it to 3–48 lowercase characters that neither start nor end with a hyphen.

- [ ] **Step 2: Continue the migration — `review_responses`**

```sql
CREATE TABLE public.review_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  review_page_id UUID NOT NULL REFERENCES public.review_pages(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  routed_to TEXT NOT NULL CHECK (routed_to IN ('destination', 'feedback')),
  comment TEXT NULL,
  contact_consent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'resolved')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  commented_at TIMESTAMPTZ NULL,
  ip_hash TEXT NULL
);

REVOKE ALL ON public.review_responses FROM anon;
GRANT SELECT, UPDATE ON public.review_responses TO authenticated;
ALTER TABLE public.review_responses ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.review_responses.restaurant_id IS
'Denormalized from review_pages so RLS filters without a join. Kept honest by review_responses_set_restaurant_id(), which overwrites it on every INSERT and UPDATE — even the service role cannot set it to a value that disagrees with the page.';
```

There is deliberately **no INSERT grant or policy for `authenticated`**: the only writer is the edge function's service role. A restaurant cannot manufacture its own five-star ratings.

- [ ] **Step 3: Continue the migration — `review_response_contacts`**

```sql
CREATE TABLE public.review_response_contacts (
  review_response_id UUID PRIMARY KEY
    REFERENCES public.review_responses(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  contact_name TEXT NULL,
  contact_email TEXT NULL
);

REVOKE ALL ON public.review_response_contacts FROM anon;
GRANT SELECT ON public.review_response_contacts TO authenticated;
ALTER TABLE public.review_response_contacts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.review_response_contacts IS
'Guest name and email, split out of review_responses because Postgres RLS is row-level: there is no way to let a view:reviews holder read a feedback row while withholding the guest email from it. SELECT here requires manage:reviews.';
```

- [ ] **Step 4: Add the two `restaurant_id` triggers**

Two functions, not one: they read different parent tables.

```sql
CREATE OR REPLACE FUNCTION public.review_responses_set_restaurant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT rp.restaurant_id INTO NEW.restaurant_id
  FROM public.review_pages rp
  WHERE rp.id = NEW.review_page_id;

  IF NEW.restaurant_id IS NULL THEN
    RAISE EXCEPTION 'review_page_id % does not exist', NEW.review_page_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER review_responses_set_restaurant_id
  BEFORE INSERT OR UPDATE ON public.review_responses
  FOR EACH ROW EXECUTE FUNCTION public.review_responses_set_restaurant_id();

CREATE OR REPLACE FUNCTION public.review_response_contacts_set_restaurant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT rr.restaurant_id INTO NEW.restaurant_id
  FROM public.review_responses rr
  WHERE rr.id = NEW.review_response_id;

  IF NEW.restaurant_id IS NULL THEN
    RAISE EXCEPTION 'review_response_id % does not exist', NEW.review_response_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER review_response_contacts_set_restaurant_id
  BEFORE INSERT OR UPDATE ON public.review_response_contacts
  FOR EACH ROW EXECUTE FUNCTION public.review_response_contacts_set_restaurant_id();

CREATE TRIGGER update_review_pages_updated_at
  BEFORE UPDATE ON public.review_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 5: Add the three indexes**

```sql
CREATE INDEX idx_review_responses_restaurant_submitted
  ON public.review_responses (restaurant_id, submitted_at DESC);

CREATE INDEX idx_review_responses_ratelimit
  ON public.review_responses (review_page_id, ip_hash, submitted_at DESC);

CREATE INDEX idx_review_responses_unread
  ON public.review_responses (restaurant_id, status)
  WHERE status = 'new';

CREATE INDEX idx_review_pages_restaurant
  ON public.review_pages (restaurant_id);
```

- [ ] **Step 6: Add the RLS policies**

```sql
CREATE POLICY review_pages_select ON public.review_pages
  FOR SELECT TO authenticated
  USING (user_has_capability(restaurant_id, 'view:reviews'));

CREATE POLICY review_pages_insert ON public.review_pages
  FOR INSERT TO authenticated
  WITH CHECK (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_pages_update ON public.review_pages
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'))
  WITH CHECK (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_pages_delete ON public.review_pages
  FOR DELETE TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_responses_select ON public.review_responses
  FOR SELECT TO authenticated
  USING (user_has_capability(restaurant_id, 'view:reviews'));

CREATE POLICY review_responses_update ON public.review_responses
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'))
  WITH CHECK (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_response_contacts_select ON public.review_response_contacts
  FOR SELECT TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'));
```

- [ ] **Step 7: Create the logo bucket and its object policies**

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'review-page-logos',
  'review-page-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read: a guest's browser loads this with no credentials.
CREATE POLICY review_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'review-page-logos');

-- Writes: manage:reviews for the restaurant that owns the first path segment.
-- storage.extension is checked in addition to the bucket's allowed_mime_types:
-- a mislabelled SVG served to every guest who scans that QR code is a blast
-- radius outside the uploader's own tenant.
CREATE POLICY review_logos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'review-page-logos'
    AND storage.extension(name) IN ('png', 'jpg', 'jpeg', 'webp')
    AND user_has_capability((storage.foldername(name))[1]::uuid, 'manage:reviews')
  );

CREATE POLICY review_logos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'review-page-logos'
    AND user_has_capability((storage.foldername(name))[1]::uuid, 'manage:reviews')
  );

CREATE POLICY review_logos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'review-page-logos'
    AND user_has_capability((storage.foldername(name))[1]::uuid, 'manage:reviews')
  );
```

Objects are keyed `{restaurant_id}/{review_page_id}/{uuid}.{ext}`, which is what makes `(storage.foldername(name))[1]` the restaurant id.

- [ ] **Step 8: Write the `review_pages` RLS test**

Create `supabase/tests/review_pages_rls_test.sql`. This follows the RLS-exercising pattern from `supabase/tests/10_invoicing_tables.sql:238-256` — set the role and the JWT claims, then assert what the policy actually does:

```sql
BEGIN;
SELECT plan(6);

-- Fixture: two restaurants, an owner in A and a chef in A.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'chef-a@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Restaurant A'),
  ('11111111-0000-0000-0000-000000000002', 'Restaurant B');

-- role_id, not the legacy `role` string: the legacy CASE has no reviews arm.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'chef',  'b0000000-0000-0000-0000-000000000004');

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.review_pages (id, restaurant_id, slug, name)
    VALUES ('22222222-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001', 'counter-a', 'Table tents')$$,
  'owner with manage:reviews can create a page'
);

SELECT is(
  (SELECT count(*)::int FROM public.review_pages),
  1,
  'owner sees the page they created'
);

SELECT throws_like(
  $$INSERT INTO public.review_pages (restaurant_id, slug, name)
    VALUES ('11111111-0000-0000-0000-000000000002', 'counter-b', 'Cross tenant')$$,
  '%row-level security policy%',
  'owner of A cannot create a page for B'
);

-- Switch to the chef: view:reviews, not manage.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);

SELECT is(
  (SELECT count(*)::int FROM public.review_pages),
  1,
  'chef with view:reviews reads the page'
);

SELECT throws_like(
  $$INSERT INTO public.review_pages (restaurant_id, slug, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'chef-page', 'Chef page')$$,
  '%row-level security policy%',
  'chef cannot create a page'
);

SELECT is(
  (SELECT count(*)::int FROM public.review_pages
   WHERE id = '22222222-0000-0000-0000-000000000001'
     AND name = 'Table tents'),
  1,
  'the chef UPDATE below is the only thing that could have changed this'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 9: Write the `review_responses` RLS test**

Create `supabase/tests/review_responses_rls_test.sql` with the same fixture header (users, restaurants, `user_restaurants` with `role_id`, and one `review_pages` row inserted as the owner), then:

```sql
SELECT plan(4);

-- The service role is the only writer. Insert the response as the table owner
-- before switching to `authenticated`.
SET LOCAL role TO postgres;
INSERT INTO public.review_responses
  (id, restaurant_id, review_page_id, rating, routed_to)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',  -- deliberately wrong; the trigger fixes it
   '22222222-0000-0000-0000-000000000001', 2, 'feedback');

SELECT is(
  (SELECT restaurant_id FROM public.review_responses
   WHERE id = '33333333-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the trigger overwrites restaurant_id from the page, ignoring what was supplied'
);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.review_responses),
  1,
  'chef with view:reviews reads the response'
);

SELECT throws_like(
  $$INSERT INTO public.review_responses (restaurant_id, review_page_id, rating, routed_to)
    VALUES ('11111111-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-000000000001', 5, 'destination')$$,
  '%permission denied%',
  'authenticated has no INSERT grant at all — a restaurant cannot fake a five-star rating'
);

SELECT is(
  (SELECT count(*)::int FROM public.review_responses
   WHERE status = 'new'),
  1,
  'the response starts in the new status'
);
```

- [ ] **Step 10: Write the contact-PII isolation test**

Create `supabase/tests/review_response_contacts_rls_test.sql` with the same fixture plus a contacts row inserted as `postgres`:

```sql
SELECT plan(3);

SET LOCAL role TO postgres;
INSERT INTO public.review_response_contacts
  (review_response_id, restaurant_id, contact_name, contact_email)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',  -- trigger overwrites
   'Dana Guest', 'dana@example.test');

SELECT is(
  (SELECT restaurant_id FROM public.review_response_contacts
   WHERE review_response_id = '33333333-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the contacts trigger derives restaurant_id from the response'
);

-- Chef: view:reviews only.
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.review_response_contacts),
  0,
  'a chef reads the comment but never the guest email'
);

-- Owner: manage:reviews.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

SELECT is(
  (SELECT contact_email FROM public.review_response_contacts),
  'dana@example.test',
  'an owner with manage:reviews reads the guest email'
);
```

- [ ] **Step 11: Reset and run**

```bash
npm run db:reset && npm run test:db 2>&1 | tail -40
```

Expected: all three new suites pass, and every pre-existing suite still passes.

- [ ] **Step 12: Verify `anon` really has nothing**

```bash
npx supabase db query "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name LIKE 'review%';" 2>&1 | tail -10
```

Expected: zero rows. If any row appears, a `REVOKE` is in the wrong place.

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations/20260804100100_review_funnel_tables.sql supabase/tests/review_pages_rls_test.sql supabase/tests/review_responses_rls_test.sql supabase/tests/review_response_contacts_rls_test.sql
git commit -m "feat(reviews): review_pages, review_responses, and split guest contact PII"
```

---
## Task 3: Server-side pure helpers — token, routing, rate limit

These three modules live under `supabase/functions/_shared/` rather than `src/lib/` because the guest is never trusted with the routing branch and the edge function cannot import from `src/`. Vitest covers them: `vitest.config.ts` includes `supabase/functions/_shared/**/*.ts` in coverage, and `tests/unit/unsubscribeToken.test.ts` already cross-imports from that directory with a relative path.

**Files:**
- Create: `supabase/functions/_shared/reviewToken.ts`
- Create: `supabase/functions/_shared/reviewRouting.ts`
- Create: `supabase/functions/_shared/reviewRateLimit.ts`
- Test: `tests/unit/reviewToken.test.ts`, `tests/unit/reviewRouting.test.ts`, `tests/unit/reviewRateLimit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Copies the HMAC *mechanism* of `supabase/functions/_shared/unsubscribeToken.ts` — not its type; `UnsubPayload` has no `exp`.
- Produces:
  - `interface ReviewTokenPayload { rid: string; exp: number }`
  - `const REVIEW_TOKEN_TTL_SECONDS = 1800`
  - `signReviewToken(payload: ReviewTokenPayload, secret: string): Promise<string>`
  - `verifyReviewToken(token: string, secret: string, nowSeconds?: number): Promise<ReviewTokenPayload | null>`
  - `type RoutedTo = 'destination' | 'feedback'`
  - `routeRating(rating: number, promoterThreshold: number, destinationUrl: string | null): { routedTo: RoutedTo; destinationUrl: string | null }`
  - `const REVIEW_RATE_LIMIT_PER_HOUR = 120`
  - `const REVIEW_RATE_WINDOW_MS = 3_600_000`
  - `hashIp(ip: string, pepper: string): Promise<string>`
  - `isOverLimit(existingCount: number): boolean`

Task 4 imports all of these.

- [ ] **Step 1: Write the failing routing test**

Create `tests/unit/reviewRouting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { routeRating } from '../../supabase/functions/_shared/reviewRouting';

describe('routeRating', () => {
  it('routes a rating at or above the threshold to the destination', () => {
    expect(routeRating(4, 4, 'https://g.page/r/abc')).toEqual({
      routedTo: 'destination',
      destinationUrl: 'https://g.page/r/abc',
    });
    expect(routeRating(5, 4, 'https://g.page/r/abc').routedTo).toBe('destination');
  });

  it('routes a rating below the threshold to feedback and withholds the URL', () => {
    expect(routeRating(3, 4, 'https://g.page/r/abc')).toEqual({
      routedTo: 'feedback',
      destinationUrl: null,
    });
  });

  it('routes everything to feedback when the page has no destination', () => {
    expect(routeRating(5, 4, null)).toEqual({
      routedTo: 'feedback',
      destinationUrl: null,
    });
  });

  it('honours a threshold of 1 (every rating is a promoter)', () => {
    expect(routeRating(1, 1, 'https://g.page/r/abc').routedTo).toBe('destination');
  });

  it('honours a threshold of 5 (only a perfect rating is a promoter)', () => {
    expect(routeRating(4, 5, 'https://g.page/r/abc').routedTo).toBe('feedback');
    expect(routeRating(5, 5, 'https://g.page/r/abc').routedTo).toBe('destination');
  });

  it('treats an out-of-range rating as feedback rather than throwing', () => {
    expect(routeRating(0, 4, 'https://g.page/r/abc').routedTo).toBe('feedback');
    expect(routeRating(9, 4, 'https://g.page/r/abc').routedTo).toBe('feedback');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/unit/reviewRouting.test.ts 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `reviewRouting`.

- [ ] **Step 3: Write `reviewRouting.ts`**

Create `supabase/functions/_shared/reviewRouting.ts`:

```typescript
// Which way a guest goes after tapping a star.
//
// This lives server-side and nowhere else. The public page never receives the
// threshold or the destination URL until the server has decided the guest has
// earned it — otherwise anyone could read the Google link out of the page's
// JavaScript and infer that low ratings are being filtered.

export type RoutedTo = 'destination' | 'feedback';

export interface RouteDecision {
  routedTo: RoutedTo;
  /** Released only when routedTo === 'destination'. */
  destinationUrl: string | null;
}

export function routeRating(
  rating: number,
  promoterThreshold: number,
  destinationUrl: string | null
): RouteDecision {
  const inRange = Number.isInteger(rating) && rating >= 1 && rating <= 5;
  const isPromoter = inRange && rating >= promoterThreshold;

  if (isPromoter && destinationUrl) {
    return { routedTo: 'destination', destinationUrl };
  }
  return { routedTo: 'feedback', destinationUrl: null };
}
```

- [ ] **Step 4: Run the routing test — green**

```bash
npx vitest run tests/unit/reviewRouting.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Write the failing token test**

Create `tests/unit/reviewToken.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  signReviewToken,
  verifyReviewToken,
  REVIEW_TOKEN_TTL_SECONDS,
  type ReviewTokenPayload,
} from '../../supabase/functions/_shared/reviewToken';

const SECRET = 'test-review-token-secret';
const NOW = 1_770_000_000;

function payload(overrides: Partial<ReviewTokenPayload> = {}): ReviewTokenPayload {
  return {
    rid: '33333333-0000-0000-0000-000000000001',
    exp: NOW + REVIEW_TOKEN_TTL_SECONDS,
    ...overrides,
  };
}

describe('reviewToken', () => {
  it('round-trips a payload', async () => {
    const token = await signReviewToken(payload(), SECRET);
    expect(await verifyReviewToken(token, SECRET, NOW)).toEqual(payload());
  });

  it('has a 30-minute time-to-live', () => {
    expect(REVIEW_TOKEN_TTL_SECONDS).toBe(1800);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signReviewToken(payload(), SECRET);
    expect(await verifyReviewToken(token, 'other-secret', NOW)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signReviewToken(payload(), SECRET);
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify(payload({ rid: 'attacker-row' })))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyReviewToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signReviewToken(payload({ exp: NOW - 1 }), SECRET);
    expect(await verifyReviewToken(token, SECRET, NOW)).toBeNull();
  });

  it('accepts a token in its final second', async () => {
    const token = await signReviewToken(payload({ exp: NOW }), SECRET);
    expect(await verifyReviewToken(token, SECRET, NOW)).not.toBeNull();
  });

  it('rejects malformed input', async () => {
    expect(await verifyReviewToken('', SECRET, NOW)).toBeNull();
    expect(await verifyReviewToken('no-dot', SECRET, NOW)).toBeNull();
    expect(await verifyReviewToken('a.b.c', SECRET, NOW)).toBeNull();
    expect(await verifyReviewToken('!!!.!!!', SECRET, NOW)).toBeNull();
  });

  it('rejects a payload missing exp', async () => {
    const bare = btoa(JSON.stringify({ rid: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyReviewToken(`${bare}.${bare}`, SECRET, NOW)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run tests/unit/reviewToken.test.ts 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `reviewToken`.

- [ ] **Step 7: Write `reviewToken.ts`**

Create `supabase/functions/_shared/reviewToken.ts`:

```typescript
// HMAC-SHA256 signed tokens proving a guest owns the review_responses row they
// are about to comment on.
//
// Same mechanism as unsubscribeToken.ts — `<payload>.<signature>`, both halves
// base64url without padding, Web Crypto so it runs unchanged in Deno and in
// Vitest — but a different payload: this one expires. An unsubscribe link is
// always allowed to work; a comment window is not.

export interface ReviewTokenPayload {
  /** review_responses.id */
  rid: string;
  /** Unix seconds. */
  exp: number;
}

/** 30 minutes: long enough to type a paragraph, short enough to be worthless later. */
export const REVIEW_TOKEN_TTL_SECONDS = 1800;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isValidPayload(p: unknown): p is ReviewTokenPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.rid === 'string' &&
    o.rid.length > 0 &&
    typeof o.exp === 'number' &&
    Number.isFinite(o.exp)
  );
}

export async function signReviewToken(
  payload: ReviewTokenPayload,
  secret: string
): Promise<string> {
  const key = await importHmacKey(secret);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifyReviewToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<ReviewTokenPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  if (!payloadPart || !sigPart) return null;

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    sigBytes = fromBase64Url(sigPart);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isValidPayload(parsed)) return null;

  const key = await importHmacKey(secret);
  const expectedBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  if (!constantTimeEqual(new Uint8Array(expectedBuf), sigBytes)) return null;

  // Signature first, expiry second: an expired token that was never ours
  // should look identical to an expired token that was.
  if (parsed.exp < nowSeconds) return null;

  return { rid: parsed.rid, exp: parsed.exp };
}
```

- [ ] **Step 8: Run the token test — green**

```bash
npx vitest run tests/unit/reviewToken.test.ts
```

Expected: 8 passed.

- [ ] **Step 9: Write the failing rate-limit test**

Create `tests/unit/reviewRateLimit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  hashIp,
  isOverLimit,
  REVIEW_RATE_LIMIT_PER_HOUR,
  REVIEW_RATE_WINDOW_MS,
} from '../../supabase/functions/_shared/reviewRateLimit';

describe('reviewRateLimit', () => {
  it('allows 120 requests per hour', () => {
    expect(REVIEW_RATE_LIMIT_PER_HOUR).toBe(120);
    expect(REVIEW_RATE_WINDOW_MS).toBe(3_600_000);
  });

  it('is over the limit only once the window is full', () => {
    expect(isOverLimit(0)).toBe(false);
    expect(isOverLimit(119)).toBe(false);
    expect(isOverLimit(120)).toBe(true);
    expect(isOverLimit(1000)).toBe(true);
  });

  it('hashes an IP to a stable 64-character hex digest', async () => {
    const a = await hashIp('203.0.113.7', 'pepper');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIp('203.0.113.7', 'pepper')).toBe(a);
  });

  it('produces different digests for different IPs', async () => {
    expect(await hashIp('203.0.113.7', 'pepper')).not.toBe(
      await hashIp('203.0.113.8', 'pepper')
    );
  });

  it('produces different digests under different peppers', async () => {
    expect(await hashIp('203.0.113.7', 'pepper-a')).not.toBe(
      await hashIp('203.0.113.7', 'pepper-b')
    );
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

```bash
npx vitest run tests/unit/reviewRateLimit.test.ts 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `reviewRateLimit`.

- [ ] **Step 11: Write `reviewRateLimit.ts`**

Create `supabase/functions/_shared/reviewRateLimit.ts`:

```typescript
// Rate limiting for the public review endpoint.
//
// 120 per hour per (review_page_id, ip_hash) is generous for a busy dining
// room behind one NAT and useless for a script. The raw IP is never stored:
// what lands in review_responses.ip_hash is sha256(ip || pepper), so the
// column is a correlation key and not a record of who visited.

export const REVIEW_RATE_LIMIT_PER_HOUR = 120;
export const REVIEW_RATE_WINDOW_MS = 3_600_000;

export async function hashIp(ip: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isOverLimit(existingCount: number): boolean {
  return existingCount >= REVIEW_RATE_LIMIT_PER_HOUR;
}
```

- [ ] **Step 12: Run all three suites and the type checker**

```bash
npx vitest run tests/unit/reviewRouting.test.ts tests/unit/reviewToken.test.ts tests/unit/reviewRateLimit.test.ts && npm run typecheck
```

Expected: 19 passed; `tsc --noEmit` clean.

- [ ] **Step 13: Commit**

```bash
git add supabase/functions/_shared/reviewToken.ts supabase/functions/_shared/reviewRouting.ts supabase/functions/_shared/reviewRateLimit.ts tests/unit/reviewToken.test.ts tests/unit/reviewRouting.test.ts tests/unit/reviewRateLimit.test.ts
git commit -m "feat(reviews): token, routing, and rate-limit helpers for the public endpoint"
```

---
## Task 4: The `review-public` edge function

The only surface the guest browser talks to. `verify_jwt = false` is not authorization — the body itself carries the proof, which is why `comment` needs a signed token rather than a row id.

**Files:**
- Create: `supabase/functions/review-public/index.ts`
- Modify: `supabase/config.toml` (add `[functions.review-public]` after the `validate-invitation` block at `:37-38`)

**Interfaces:**
- Consumes: `signReviewToken`, `verifyReviewToken`, `REVIEW_TOKEN_TTL_SECONDS` from `../_shared/reviewToken.ts`; `routeRating` from `../_shared/reviewRouting.ts`; `hashIp`, `isOverLimit`, `REVIEW_RATE_WINDOW_MS` from `../_shared/reviewRateLimit.ts`; `corsHeaders` from `../_shared/cors.ts`; the tables from Task 2.
- Produces: `POST /functions/v1/review-public` with three actions. Task 6 calls all three.

| Action | Request body | Response |
|---|---|---|
| `page` | `{ action: 'page', slug }` | `{ restaurant_name, headline, subheadline, logo_url, threshold }` |
| `rate` | `{ action: 'rate', slug, rating, hp? }` | `{ token, routed_to, destination_url? }` |
| `comment` | `{ action: 'comment', token, comment, name?, email?, consent?, hp? }` | `{ ok: true }` |

- [ ] **Step 1: Register the function in `supabase/config.toml`**

Insert immediately after the `[functions.validate-invitation]` block:

```toml
[functions.review-public]
verify_jwt = false
```

- [ ] **Step 2: Write the function skeleton — CORS, dispatch, generic errors**

Create `supabase/functions/review-public/index.ts`:

```typescript
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
```

- [ ] **Step 3: Implement `page`**

Append to the same file:

```typescript
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
```

`destination_url` is deliberately absent from this payload: releasing it here would let anyone read the Google link out of the page's network tab and infer that low ratings are being filtered.

- [ ] **Step 4: Implement `rate`**

```typescript
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
```

The rating is written before anything is shown: a guest who taps two and closes the tab still leaves the two.

- [ ] **Step 5: Implement `comment`**

```typescript
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
```

- [ ] **Step 6: Type-check the function under Deno**

```bash
npx supabase functions serve review-public --no-verify-jwt --env-file .env.local 2>&1 | head -20
```

Expected: the function compiles and reports it is serving. Stop it with Ctrl-C — the Bash tool's `timeout` bounds this; do not wrap it in a poll loop.

- [ ] **Step 7: Exercise the three actions against local Supabase**

With `npm run db:start` already up and the function served in a trapped background shell:

```bash
npm run functions:serve & pid=$!
trap 'kill $pid 2>/dev/null' EXIT
sleep 8
curl -s -X POST http://localhost:54321/functions/v1/review-public -H 'Content-Type: application/json' -d '{"action":"page","slug":"does-not-exist"}'
```

Expected: `{"inactive":true}` — the same answer a paused page gives.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/review-public/index.ts supabase/config.toml
git commit -m "feat(reviews): review-public edge function with server-side routing"
```

**Deploy note for the reviewer:** two new edge-function secrets must be set before this ships — `REVIEW_TOKEN_SECRET` and `REVIEW_IP_PEPPER`. They are the only new configuration this feature needs. Do not reuse one value for both; a signing key should not double as a hashing pepper.

---
## Task 5: Client-side pure helpers — slug and metrics

`src/components/**` and `src/pages/**` are excluded from coverage measurement in `vitest.config.ts`; `src/lib/**` is not. Slug generation and response aggregation therefore live in `src/lib/reviews/`, not inside the builder component.

**Files:**
- Create: `src/lib/reviews/reviewSlug.ts`
- Create: `src/lib/reviews/reviewMetrics.ts`
- Test: `tests/unit/reviewSlug.test.ts`, `tests/unit/reviewMetrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const SLUG_PATTERN: RegExp` — the exact mirror of the SQL `CHECK` from Task 2
  - `slugifyPageName(name: string): string`
  - `randomSlugSuffix(): string` — four lowercase base-36 characters
  - `withCollisionSuffix(base: string): string`
  - `isValidSlug(slug: string): boolean`
  - `interface ReviewResponseSummary { rating: number; hasComment: boolean; status: 'new' | 'in_progress' | 'resolved' }`
  - `interface ReviewMetrics { averageRating: number | null; totalRatings: number; commentCount: number; unreadCount: number }`
  - `summarizeResponses(rows: readonly ReviewResponseSummary[]): ReviewMetrics`

Tasks 8 and 9 import these.

- [ ] **Step 1: Write the failing slug test**

Create `tests/unit/reviewSlug.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SLUG_PATTERN,
  slugifyPageName,
  randomSlugSuffix,
  withCollisionSuffix,
  isValidSlug,
} from '@/lib/reviews/reviewSlug';

describe('slugifyPageName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyPageName('Table Tents')).toBe('table-tents');
  });

  it('strips punctuation and collapses runs of separators', () => {
    expect(slugifyPageName("Joe's  Bar & Grill!!")).toBe('joes-bar-grill');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyPageName('--front door--')).toBe('front-door');
  });

  it('truncates to 43 characters so a collision suffix still fits', () => {
    const long = 'a'.repeat(80);
    expect(slugifyPageName(long)).toHaveLength(43);
  });

  it('never leaves a trailing hyphen after truncation', () => {
    const awkward = `${'a'.repeat(43)} tail`;
    const slug = slugifyPageName(awkward);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('falls back for names that reduce to fewer than three characters', () => {
    expect(slugifyPageName('!!')).toBe('review-page');
    expect(slugifyPageName('ab')).toBe('review-page');
  });

  it('produces a slug the SQL CHECK accepts', () => {
    for (const name of ['Table Tents', 'Front Door', "Joe's Bar & Grill"]) {
      expect(SLUG_PATTERN.test(slugifyPageName(name))).toBe(true);
    }
  });
});

describe('withCollisionSuffix', () => {
  it('appends four characters after a hyphen', () => {
    const out = withCollisionSuffix('table-tents');
    expect(out).toMatch(/^table-tents-[a-z0-9]{4}$/);
  });

  it('keeps the result inside 48 characters even from a maximal base', () => {
    const out = withCollisionSuffix('a'.repeat(43));
    expect(out.length).toBe(48);
    expect(isValidSlug(out)).toBe(true);
  });

  it('re-truncates a base that is already too long', () => {
    expect(withCollisionSuffix('b'.repeat(60)).length).toBe(48);
  });
});

describe('randomSlugSuffix', () => {
  it('is four lowercase alphanumerics', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{4}$/);
    }
  });
});

describe('isValidSlug', () => {
  it('accepts the shortest and longest legal slugs', () => {
    expect(isValidSlug('abc')).toBe(true);
    expect(isValidSlug('a'.repeat(48))).toBe(true);
  });

  it('rejects slugs that are too short, too long, or edge-hyphenated', () => {
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('a'.repeat(49))).toBe(false);
    expect(isValidSlug('-abc')).toBe(false);
    expect(isValidSlug('abc-')).toBe(false);
    expect(isValidSlug('Abc')).toBe(false);
    expect(isValidSlug('a b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/unit/reviewSlug.test.ts 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `@/lib/reviews/reviewSlug`.

- [ ] **Step 3: Write `reviewSlug.ts`**

Create `src/lib/reviews/reviewSlug.ts`:

```typescript
// Slug generation for public review pages.
//
// SLUG_PATTERN mirrors the SQL CHECK in
// supabase/migrations/20260804100100_review_funnel_tables.sql exactly: 3–48
// characters, lowercase alphanumerics and hyphens, never starting or ending
// with a hyphen. If one changes, the other must.

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

const MAX_SLUG_LENGTH = 48;
const SUFFIX_LENGTH = 4;
/** Leaves room for `-` plus a four-character suffix inside MAX_SLUG_LENGTH. */
const MAX_BASE_LENGTH = MAX_SLUG_LENGTH - SUFFIX_LENGTH - 1;
const FALLBACK_SLUG = 'review-page';

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

export function slugifyPageName(name: string): string {
  const base = trimHyphens(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
  ).slice(0, MAX_BASE_LENGTH);

  const cleaned = trimHyphens(base);
  return cleaned.length >= 3 ? cleaned : FALLBACK_SLUG;
}

export function randomSlugSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  crypto.getRandomValues(bytes);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function withCollisionSuffix(base: string): string {
  const trimmed = trimHyphens(base.slice(0, MAX_BASE_LENGTH));
  const safe = trimmed.length >= 3 ? trimmed : FALLBACK_SLUG;
  return `${safe}-${randomSlugSuffix()}`;
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}
```

Note `SLUG_PATTERN` alone does not bound the upper length — `{1,46}` plus two anchors caps it at 48, so `isValidSlug` checks length explicitly rather than relying on the reader to do that arithmetic.

- [ ] **Step 4: Run the slug test — green**

```bash
npx vitest run tests/unit/reviewSlug.test.ts
```

Expected: 14 passed.

- [ ] **Step 5: Write the failing metrics test**

Create `tests/unit/reviewMetrics.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run tests/unit/reviewMetrics.test.ts 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `@/lib/reviews/reviewMetrics`.

- [ ] **Step 7: Write `reviewMetrics.ts`**

Create `src/lib/reviews/reviewMetrics.ts`:

```typescript
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
```

- [ ] **Step 8: Run both suites and the type checker**

```bash
npx vitest run tests/unit/reviewSlug.test.ts tests/unit/reviewMetrics.test.ts && npm run typecheck
```

Expected: 19 passed; `tsc --noEmit` clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/reviews/reviewSlug.ts src/lib/reviews/reviewMetrics.ts tests/unit/reviewSlug.test.ts tests/unit/reviewMetrics.test.ts
git commit -m "feat(reviews): slug generation and response aggregation helpers"
```

---
## Task 6: The Counter theme, the star control, and the public page

**Files:**
- Create: `src/styles/counter-theme.css`
- Create: `src/components/reviews/StarRating.tsx`
- Create: `src/pages/ReviewPage.tsx`
- Modify: `src/App.tsx:1-8` (add `lazy`, `Suspense`), `:305-310` (add the route)
- Modify: `package.json` (add `@fontsource/zilla-slab`, `@fontsource/ibm-plex-mono`)

**Interfaces:**
- Consumes: the `review-public` endpoint from Task 4 — actions `page`, `rate`, `comment` with the exact request and response shapes listed in that task.
- Produces:
  - `StarRating` props: `{ value: number; onPreview: (rating: number) => void; onCommit: (rating: number) => void; disabled?: boolean }`
  - Default export `ReviewPage` at `src/pages/ReviewPage.tsx`, reachable at `/r/:slug`.

**Deviation from the spec:** the spec places woff2 files in `/public/fonts`. This task uses the `@fontsource` packages instead — same self-hosted latin subset, same `font-display: swap`, but installable by `npm ci` and versioned in the lockfile.

- [ ] **Step 1: Install the two font packages**

```bash
npm install @fontsource/zilla-slab@^5 @fontsource/ibm-plex-mono@^5
```

- [ ] **Step 2: Write the Counter theme scope**

Create `src/styles/counter-theme.css`:

```css
/* "Counter" — the check-presenter look, used only by the public review page.
 *
 * This is src/index.css's warm light palette, slightly deepened. Every value
 * is the same HSL custom property the rest of the app uses, so components keep
 * their semantic classes (bg-background, text-foreground, border-border) and
 * no direct colour appears anywhere.
 *
 * The tokens are pinned absolutely rather than inheriting .dark: the guest is
 * not logged in and has no theme preference of ours, and the page is paper in
 * both. Custom properties declared on the element itself beat an ancestor's
 * inherited value regardless of specificity, so no !important is needed.
 *
 * Contrast gate: --muted-foreground (30 12% 34%) on --background (38 34% 96%)
 * computes to 8.1:1, comfortably past AA for body copy. If either value moves,
 * recompute before committing — the micro-copy tone is the one most likely to
 * fail, and a page read in daylight on a phone has no margin for a stylish grey.
 */

.theme-counter {
  --background: 38 34% 96%;
  --foreground: 28 18% 12%;

  --card: 40 40% 99%;
  --card-foreground: 28 18% 12%;

  --popover: 40 40% 99%;
  --popover-foreground: 28 18% 12%;

  --primary: 16 62% 40%;
  --primary-foreground: 40 40% 99%;

  --secondary: 38 26% 91%;
  --secondary-foreground: 28 18% 12%;

  --muted: 38 22% 89%;
  --muted-foreground: 30 12% 34%;

  --accent: 85 22% 38%;
  --accent-foreground: 40 40% 99%;

  --destructive: 0 62% 38%;
  --destructive-foreground: 40 40% 99%;

  --border: 34 20% 80%;
  --input: 34 20% 80%;
  --ring: 16 62% 40%;

  --radius: 0.5rem;

  --font-display: 'Zilla Slab', Georgia, serif;
  --font-mono-micro: 'IBM Plex Mono', ui-monospace, monospace;
}

.theme-counter .counter-display {
  font-family: var(--font-display);
  letter-spacing: -0.01em;
}

.theme-counter .counter-micro {
  font-family: var(--font-mono-micro);
  letter-spacing: 0.02em;
}

/* Dashed hairline rules, top and bottom of the paper card. */
.theme-counter .counter-rule {
  border-top: 1px dashed hsl(var(--border));
}
```

- [ ] **Step 3: Write the star control**

Create `src/components/reviews/StarRating.tsx`:

```tsx
import { useRef, useState, KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

interface StarRatingProps {
  /** The previewed star, 0 when nothing is focused yet. */
  value: number;
  onPreview: (rating: number) => void;
  onCommit: (rating: number) => void;
  disabled?: boolean;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * A radiogroup whose arrow keys PREVIEW rather than select.
 *
 * The ARIA APG radio pattern makes arrow keys check the newly-focused radio.
 * Here the rating is written the instant it is selected and selection moves
 * focus to the next branch's heading — so a keyboard user pressing → once from
 * star 1 would file a 2, be branched on it, and lose access to stars 3–5.
 *
 * Arrow keys therefore move a roving tabindex and update aria-checked for
 * preview only; the write fires on Enter, Space, or a tap. Radix RadioGroup
 * implements selection-follows-focus and cannot be used as-is for this reason.
 */
export function StarRating({ value, onPreview, onCommit, disabled = false }: StarRatingProps) {
  const [focused, setFocused] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const active = focused || value || 1;

  const moveTo = (next: number) => {
    const clamped = Math.min(5, Math.max(1, next));
    setFocused(clamped);
    onPreview(clamped);
    refs.current[clamped - 1]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, star: number) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo(star + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo(star - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(1);
        break;
      case 'End':
        event.preventDefault();
        moveTo(5);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onCommit(star);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Rate your visit from 1 to 5 stars"
      className="flex items-center justify-center gap-2"
    >
      {STARS.map((star) => (
        <button
          key={star}
          ref={(el) => {
            refs.current[star - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} out of 5 stars`}
          tabIndex={star === active ? 0 : -1}
          disabled={disabled}
          onFocus={() => setFocused(star)}
          onKeyDown={(event) => handleKeyDown(event, star)}
          onClick={() => onCommit(star)}
          className={cn(
            'counter-display select-none rounded-md px-1 text-[44px] leading-none transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            star <= value ? 'text-primary' : 'text-muted-foreground/40',
            disabled && 'opacity-60'
          )}
        >
          {star <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}
```

Stars are text glyphs, not icon components: one less request on restaurant wifi, and they scale with the type.

- [ ] **Step 4: Write the public page — data loading and the land state**

Create `src/pages/ReviewPage.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import { StarRating } from '@/components/reviews/StarRating';

import { supabase } from '@/integrations/supabase/client';

import '@fontsource/zilla-slab/400.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@/styles/counter-theme.css';

interface PublicPage {
  restaurant_name: string;
  headline: string;
  subheadline: string | null;
  logo_url: string | null;
  threshold: number;
}

type Stage = 'land' | 'promoter' | 'feedback' | 'thanks' | 'thanks_unknown';

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

  const [page, setPage] = useState<PublicPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactive, setInactive] = useState(false);

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

  const [announcement, setAnnouncement] = useState('');
  const branchHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke('review-public', {
        body: { action: 'page', slug },
      });
      if (cancelled) return;
      if (error || !data || data.inactive) {
        setInactive(true);
      } else {
        setPage(data as PublicPage);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (stage !== 'land') branchHeadingRef.current?.focus();
  }, [stage]);
```

- [ ] **Step 5: Add the commit handler**

Continue inside `ReviewPage`:

```tsx
  const handlePreview = useCallback((rating: number) => {
    setPreview(rating);
    setAnnouncement(`${rating} out of 5 stars`);
  }, []);

  const handleCommit = useCallback(
    async (rating: number) => {
      if (committed) return;
      setCommitted(rating);
      setPreview(rating);

      const { data, error } = await supabase.functions.invoke('review-public', {
        body: { action: 'rate', slug, rating, hp: honeypot },
      });

      // The rate call never completed, so routed_to never arrived and the
      // client does not know which branch this guest belongs in. Fall back to
      // a plain thank-you with no call to action: handing a Google link to a
      // guest who may have tapped one star is the worst outcome available.
      if (error || !data?.token) {
        setStage('thanks_unknown');
        setAnnouncement('Thanks — your rating was received.');
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
    [committed, honeypot, slug]
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
```

- [ ] **Step 6: Render the paper card and its states**

Continue the component's return:

```tsx
  const card = 'w-full max-w-md rounded-lg border border-border bg-card px-6 py-8 shadow-sm';

  if (loading) {
    return (
      <div className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
        <div className={card}>
          <Skeleton className="mx-auto h-14 w-14 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-5 w-40" />
          <Skeleton className="mx-auto mt-6 h-10 w-56" />
        </div>
      </div>
    );
  }

  if (inactive || !page) {
    return (
      <div className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
        <div className={card}>
          <h1 className="counter-display text-[22px] font-semibold text-foreground text-center">
            This link isn&apos;t active
          </h1>
          <p className="counter-micro mt-3 text-[12px] text-muted-foreground text-center">
            Ask the restaurant for a current one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
      <div className={card}>
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

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

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
            <p className="counter-micro mt-6 text-center text-[12px] text-muted-foreground">
              tap a star — 10 seconds, no account
            </p>
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
```

The Google link is a **button with a visible out**, not an auto-redirect. Firing the guest at Google the instant they tap five is functionally review-gating.

- [ ] **Step 7: Render the feedback form and the confirmations**

```tsx
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

        {(stage === 'thanks' || stage === 'thanks_unknown') && (
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
      </div>
    </div>
  );
}
```

The error state is a plain bordered card, not `Alert variant="destructive"`: `src/components/ui/alert.tsx` carries a hardcoded `dark:border-destructive` Tailwind variant that would not follow the `.theme-counter` override if `.dark` ever landed on an ancestor.

- [ ] **Step 8: Add the lazy route to `src/App.tsx`**

Change the React import line at the top of the file to include `lazy` and `Suspense`:

```tsx
import { lazy, Suspense } from "react";
```

Add the lazy component beside the other page imports (after the `Unsubscribe` import at `:39`):

```tsx
// Lazy on purpose. The public review page pulls in two webfonts and the
// Counter stylesheet that no authenticated user will ever render; every other
// route here is a static import, so adding this one the same way would
// silently defeat the isolation.
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
```

Add the route immediately after `/unsubscribe` at `:310`:

```tsx
            <Route
              path="/r/:slug"
              element={
                <Suspense
                  fallback={
                    <div className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
                      <div className="w-full max-w-md rounded-lg border border-border bg-card px-6 py-8 shadow-sm" />
                    </div>
                  }
                >
                  <ReviewPage />
                </Suspense>
              }
            />
```

The fallback is the paper card skeleton, not the app's spinner: a logged-out guest should never see app chrome.

- [ ] **Step 9: Verify the chunk split**

```bash
npm run build 2>&1 | tail -30
```

Expected: a separate `ReviewPage-*.js` chunk and a `ReviewPage-*.css` chunk appear in the output. Then confirm the fonts followed the chunk rather than landing in the entry CSS:

```bash
grep -l "Zilla" dist/assets/*.css
```

Expected: the match is a `ReviewPage-*.css` file, **not** `index-*.css`. If it is the index stylesheet, the `@fontsource` imports leaked into the main chunk and the lazy boundary is not doing its job.

- [ ] **Step 10: Lint and type-check**

```bash
npm run lint && npm run typecheck
```

Expected: clean. In particular no `no-restricted-syntax` violation — `ReviewPage.tsx` renders no dates.

- [ ] **Step 11: Commit**

```bash
git add src/styles/counter-theme.css src/components/reviews/StarRating.tsx src/pages/ReviewPage.tsx src/App.tsx package.json package-lock.json
git commit -m "feat(reviews): public /r/:slug landing page in the Counter theme"
```

---
## Task 7: The admin data hooks

**Files:**
- Create: `src/hooks/useReviewPages.ts`
- Create: `src/hooks/useReviewResponses.ts`

**Interfaces:**
- Consumes: `summarizeResponses`, `ReviewMetrics`, `ReviewResponseSummary` from Task 5; the tables from Task 2.
- Produces:
  - `interface ReviewPage { id; restaurant_id; slug; name; is_active; logo_path; headline; subheadline; promoter_threshold; destination_url; created_at; updated_at }`
  - `interface ReviewPageWithStats extends ReviewPage { averageRating: number | null; ratingCount: number; commentCount: number }`
  - `useReviewPages(restaurantId?: string)` → `{ pages, isLoading, error, createPage, updatePage, uploadLogo, isSaving }`
  - `interface ReviewResponse { id; restaurant_id; review_page_id; rating; routed_to; comment; contact_consent; status; submitted_at; commented_at }`
  - `interface ReviewResponseContact { contact_name: string | null; contact_email: string | null }`
  - `useReviewResponses(restaurantId?: string)` → `{ responses, metrics, isLoading, error, updateStatus, fetchContact }`

Task 8 uses `useReviewPages`; Task 9 uses `useReviewResponses`.

The generated `src/integrations/supabase/types.ts` will not know these tables until types are regenerated, so every builder call uses `.from('review_pages' as any)` with an explicit local interface, matching how other recently-added tables are consumed in this repo.

- [ ] **Step 1: Write `useReviewPages.ts` — types and the list query**

Create `src/hooks/useReviewPages.ts`:

```typescript
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ReviewPage {
  id: string;
  restaurant_id: string;
  slug: string;
  name: string;
  is_active: boolean;
  logo_path: string | null;
  headline: string;
  subheadline: string | null;
  promoter_threshold: number;
  destination_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewPageWithStats extends ReviewPage {
  averageRating: number | null;
  ratingCount: number;
  commentCount: number;
}

interface ResponseStatRow {
  review_page_id: string;
  rating: number;
  comment: string | null;
}

export function useReviewPages(restaurantId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['review-pages', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewPageWithStats[]> => {
      // Two queries, not one per card. The stats query returns every response
      // for the restaurant and is folded into per-page aggregates in memory —
      // a restaurant with five pages costs two round trips, not six.
      const [pagesResult, statsResult] = await Promise.all([
        supabase
          .from('review_pages' as any)
          .select(
            'id, restaurant_id, slug, name, is_active, logo_path, headline, subheadline, promoter_threshold, destination_url, created_at, updated_at'
          )
          .eq('restaurant_id', restaurantId!)
          .order('created_at', { ascending: false }),
        supabase
          .from('review_responses' as any)
          .select('review_page_id, rating, comment')
          .eq('restaurant_id', restaurantId!),
      ]);

      if (pagesResult.error) throw pagesResult.error;
      if (statsResult.error) throw statsResult.error;

      const totals = new Map<string, { sum: number; count: number; comments: number }>();
      for (const row of (statsResult.data ?? []) as unknown as ResponseStatRow[]) {
        const entry = totals.get(row.review_page_id) ?? { sum: 0, count: 0, comments: 0 };
        entry.sum += row.rating;
        entry.count += 1;
        if (row.comment) entry.comments += 1;
        totals.set(row.review_page_id, entry);
      }

      return ((pagesResult.data ?? []) as unknown as ReviewPage[]).map((page) => {
        const entry = totals.get(page.id);
        return {
          ...page,
          averageRating: entry && entry.count > 0 ? Math.round((entry.sum / entry.count) * 10) / 10 : null,
          ratingCount: entry?.count ?? 0,
          commentCount: entry?.comments ?? 0,
        };
      });
    },
  });
```

- [ ] **Step 2: Add the create and update mutations**

Continue in the same hook, before the return:

```typescript
  const createPage = useMutation({
    mutationFn: async (input: {
      name: string;
      slug: string;
      headline: string;
      subheadline: string | null;
      promoter_threshold: number;
      destination_url: string | null;
    }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data: auth } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('review_pages' as any)
        .insert({
          ...input,
          restaurant_id: restaurantId,
          created_by: auth.user?.id ?? null,
        })
        .select('id')
        .single();

      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      toast({ title: 'Page created' });
    },
    onError: (error: Error) => {
      const duplicate = error.message.includes('review_pages_slug_key');
      toast({
        title: duplicate ? 'That link is taken' : 'Could not create the page',
        description: duplicate ? 'Pick a different link and try again.' : error.message,
        variant: 'destructive',
      });
    },
  });

  const updatePage = useMutation({
    mutationFn: async ({ id, ...rest }: Partial<ReviewPage> & { id: string }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      // The .eq('restaurant_id', …) is belt to RLS's braces: an id from a stale
      // cache or a hand-edited request can never reach another tenant's row.
      const { error } = await supabase
        .from('review_pages' as any)
        .update(rest)
        .eq('id', id)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      toast({ title: 'Saved' });
    },
    onError: (error: Error) => {
      const duplicate = error.message.includes('review_pages_slug_key');
      toast({
        title: duplicate ? 'That link is taken' : 'Could not save',
        description: duplicate ? 'Pick a different link and try again.' : error.message,
        variant: 'destructive',
      });
    },
  });
```

- [ ] **Step 3: Add the logo upload and close the hook**

```typescript
  const uploadLogo = useCallback(
    async (pageId: string, file: File): Promise<string> => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${restaurantId}/${pageId}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('review-page-logos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('review_pages' as any)
        .update({ logo_path: path })
        .eq('id', pageId)
        .eq('restaurant_id', restaurantId);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      return path;
    },
    [queryClient, restaurantId]
  );

  return {
    pages: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    createPage: createPage.mutateAsync,
    updatePage: updatePage.mutateAsync,
    uploadLogo,
    isSaving: createPage.isPending || updatePage.isPending,
  };
}
```

The storage key is `{restaurant_id}/{review_page_id}/{uuid}.{ext}` — exactly the shape the four `storage.objects` policies from Task 2 check with `(storage.foldername(name))[1]::uuid`.

- [ ] **Step 4: Write `useReviewResponses.ts`**

Create `src/hooks/useReviewResponses.ts`:

```typescript
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { summarizeResponses, type ReviewMetrics } from '@/lib/reviews/reviewMetrics';

export type ReviewResponseStatus = 'new' | 'in_progress' | 'resolved';

export interface ReviewResponse {
  id: string;
  restaurant_id: string;
  review_page_id: string;
  rating: number;
  routed_to: 'destination' | 'feedback';
  comment: string | null;
  contact_consent: boolean;
  status: ReviewResponseStatus;
  submitted_at: string;
  commented_at: string | null;
}

export interface ReviewResponseContact {
  contact_name: string | null;
  contact_email: string | null;
}

export function useReviewResponses(restaurantId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['review-responses', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewResponse[]> => {
      const { data, error } = await supabase
        .from('review_responses' as any)
        .select(
          'id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status, submitted_at, commented_at'
        )
        .eq('restaurant_id', restaurantId!)
        .order('submitted_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return (data ?? []) as unknown as ReviewResponse[];
    },
  });

  const responses = query.data ?? [];

  // Every rating feeds the average; only commented rows reach the list.
  const metrics: ReviewMetrics = summarizeResponses(
    responses.map((row) => ({
      rating: row.rating,
      hasComment: Boolean(row.comment),
      status: row.status,
    }))
  );

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ReviewResponseStatus }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { error } = await supabase
        .from('review_responses' as any)
        .update({ status })
        .eq('id', id)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-responses', restaurantId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not update', description: error.message, variant: 'destructive' });
    },
  });

  // Contact details live in their own table so that RLS — which is row-level,
  // not column-level — can hold them to manage:reviews while the comment
  // itself stays readable at view:reviews. A viewer's fetch returns no rows
  // rather than an error, and the caller renders nothing.
  const fetchContact = useCallback(
    async (responseId: string): Promise<ReviewResponseContact | null> => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await supabase
        .from('review_response_contacts' as any)
        .select('contact_name, contact_email')
        .eq('review_response_id', responseId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) return null;
      return (data as unknown as ReviewResponseContact) ?? null;
    },
    [restaurantId]
  );

  return {
    responses,
    metrics,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    updateStatus: updateStatus.mutateAsync,
    fetchContact,
  };
}
```

- [ ] **Step 5: Type-check and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useReviewPages.ts src/hooks/useReviewResponses.ts
git commit -m "feat(reviews): admin data hooks for pages and responses"
```

---
## Task 8: The `/reviews` page, the Pages tab, the builder, and the QR block

**Files:**
- Create: `src/components/reviews/ReviewQrDialog.tsx`
- Create: `src/components/reviews/ReviewPageBuilder.tsx`
- Create: `src/pages/Reviews.tsx`
- Modify: `src/components/AppSidebar.nav.ts` (Main group, after `/ops-inbox`)
- Modify: `src/App.tsx` (route beside `/ops-inbox` at `:356`)
- Modify: `package.json` (add `qrcode`, `@types/qrcode`)

**Interfaces:**
- Consumes: `useReviewPages`, `ReviewPageWithStats` (Task 7); `slugifyPageName`, `withCollisionSuffix`, `isValidSlug` (Task 5); `usePermissions` (existing).
- Produces:
  - `ReviewQrDialog` props: `{ open: boolean; onOpenChange: (open: boolean) => void; slug: string; publicUrl: string }`
  - `ReviewPageBuilder` props: `{ page: ReviewPageWithStats | null; restaurantId: string; onCreated: (id: string) => void }`
  - Default export `Reviews` at `src/pages/Reviews.tsx`.

Task 9 renders its Feedback tab inside the same `Reviews.tsx` shell.

- [ ] **Step 1: Install the QR library**

```bash
npm install qrcode@^1.5.4 && npm install --save-dev @types/qrcode@^1.5.5
```

`qrcode` is MIT, has no runtime dependencies that reach the DOM, and is imported dynamically below so it never enters the main chunk.

- [ ] **Step 2: Write the QR dialog**

Create `src/components/reviews/ReviewQrDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { QrCode } from 'lucide-react';

interface ReviewQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  publicUrl: string;
}

function download(filename: string, href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ReviewQrDialog({ open, onOpenChange, slug, publicUrl }: ReviewQrDialogProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSvg(null);
    setPng(null);
    setFailed(false);

    (async () => {
      try {
        // Dynamic import: the QR encoder is ~50 KB and only a manager opening
        // this dialog ever needs it. A static import would put it in the main
        // chunk for every user on every page.
        const QRCode = await import('qrcode');
        const options = { margin: 1, width: 512, errorCorrectionLevel: 'M' as const };
        const [svgString, dataUrl] = await Promise.all([
          QRCode.toString(publicUrl, { ...options, type: 'svg' }),
          QRCode.toDataURL(publicUrl, options),
        ]);
        if (cancelled) return;
        setSvg(svgString);
        setPng(dataUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, publicUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <QrCode className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                QR code
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Print it for the table, the check presenter, or the door.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {failed ? (
            <p className="text-[13px] text-muted-foreground">
              The code didn&apos;t generate. Close this and try again.
            </p>
          ) : svg ? (
            <div
              className="mx-auto h-48 w-48 [&>svg]:h-full [&>svg]:w-full"
              aria-label={`QR code linking to ${publicUrl}`}
              role="img"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <Skeleton className="mx-auto h-48 w-48 rounded-lg" />
          )}

          <p className="text-[12px] text-muted-foreground text-center break-all">{publicUrl}</p>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!svg}
              aria-label="Download QR code as SVG"
              className="h-9 flex-1 rounded-lg text-[13px] font-medium"
              onClick={() =>
                svg &&
                download(
                  `${slug}-qr.svg`,
                  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
                )
              }
            >
              Download SVG
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!png}
              aria-label="Download QR code as PNG"
              className="h-9 flex-1 rounded-lg text-[13px] font-medium"
              onClick={() => png && download(`${slug}-qr.png`, png)}
            >
              Download PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

The SVG is the one a printer wants; the PNG is the one that pastes into a menu template. Both encode the public URL, not the page id — the code has to survive being reprinted from a photo of a table tent.

- [ ] **Step 3: Write the builder — state and the identity fields**

Create `src/components/reviews/ReviewPageBuilder.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import { QrCode, Upload } from 'lucide-react';

import { useReviewPages, type ReviewPageWithStats } from '@/hooks/useReviewPages';
import { isValidSlug, slugifyPageName, withCollisionSuffix } from '@/lib/reviews/reviewSlug';

import { ReviewQrDialog } from './ReviewQrDialog';

interface ReviewPageBuilderProps {
  page: ReviewPageWithStats | null;
  restaurantId: string;
  onCreated: (id: string) => void;
}

const THRESHOLDS = [1, 2, 3, 4, 5] as const;

export function ReviewPageBuilder({ page, restaurantId, onCreated }: ReviewPageBuilderProps) {
  const { createPage, updatePage, uploadLogo, isSaving } = useReviewPages(restaurantId);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [headline, setHeadline] = useState('How was everything?');
  const [subheadline, setSubheadline] = useState('');
  const [threshold, setThreshold] = useState(4);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    setName(page?.name ?? '');
    setSlug(page?.slug ?? '');
    setSlugTouched(Boolean(page));
    setHeadline(page?.headline ?? 'How was everything?');
    setSubheadline(page?.subheadline ?? '');
    setThreshold(page?.promoter_threshold ?? 4);
    setDestinationUrl(page?.destination_url ?? '');
    setIsActive(page?.is_active ?? true);
  }, [page]);

  const publicUrl = `${window.location.origin}/r/${slug}`;
  const slugError = slug.length > 0 && !isValidSlug(slug);
  const urlError = destinationUrl.length > 0 && !destinationUrl.startsWith('https://');
  const canSave = name.trim().length > 0 && isValidSlug(slug) && !urlError;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugifyPageName(value));
  };

  const handleSave = async () => {
    const payload = {
      name: name.trim(),
      slug,
      headline: headline.trim() || 'How was everything?',
      subheadline: subheadline.trim() || null,
      promoter_threshold: threshold,
      destination_url: destinationUrl.trim() || null,
    };

    if (page) {
      await updatePage({ id: page.id, ...payload, is_active: isActive });
    } else {
      const created = await createPage(payload);
      onCreated(created.id);
    }
  };
```

`slugifyPageName` follows the name only until the manager edits the link themselves. After that the link is theirs — a printed QR code that silently repoints because someone fixed a typo in the page name is the worst bug this feature could ship.

- [ ] **Step 4: Add the logo handler and render the form**

```tsx
  const handleLogo = async (file: File | undefined) => {
    if (!file || !page) return;
    await uploadLogo(page.id, file);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">The page</h3>
          {page && (
            <div className="flex items-center gap-2">
              <Label htmlFor="page-active" className="text-[12px] text-muted-foreground">
                Live
              </Label>
              <Switch
                id="page-active"
                checked={isActive}
                onCheckedChange={setIsActive}
                className="data-[state=checked]:bg-foreground"
              />
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          <div>
            <Label
              htmlFor="page-name"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Name
            </Label>
            <Input
              id="page-name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Table tents"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Only you see this — it&apos;s how you tell your pages apart.
            </p>
          </div>

          <div>
            <Label
              htmlFor="page-slug"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Public link
            </Label>
            <Input
              id="page-slug"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value.toLowerCase());
              }}
              aria-invalid={slugError}
              aria-describedby="page-slug-help"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p id="page-slug-help" className="mt-1 text-[12px] text-muted-foreground break-all">
              {slugError
                ? '3–48 characters: lowercase letters, numbers, and hyphens, not starting or ending with one.'
                : publicUrl}
            </p>
            {slugError && (
              <Button
                type="button"
                variant="ghost"
                className="mt-1 h-8 px-0 text-[12px] text-muted-foreground hover:text-foreground"
                onClick={() => setSlug(withCollisionSuffix(slugifyPageName(name)))}
              >
                Suggest one
              </Button>
            )}
          </div>

          <div>
            <Label
              htmlFor="page-headline"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Headline
            </Label>
            <Input
              id="page-headline"
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          <div>
            <Label
              htmlFor="page-subheadline"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Subheadline
            </Label>
            <Input
              id="page-subheadline"
              value={subheadline}
              onChange={(event) => setSubheadline(event.target.value)}
              placeholder="Optional"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
        </div>
      </div>
```

- [ ] **Step 5: Add the routing section, the logo, and the QR block**

```tsx
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
          <h3 className="text-[13px] font-semibold text-foreground">Where ratings go</h3>
        </div>

        <div className="p-4 space-y-4">
          <fieldset>
            <legend className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Send to Google at
            </legend>
            {/* Selection-follows-focus is correct here: this is an ordinary
                setting, arrowing through it commits nothing but a local state
                change, and the manager still has to press Save. Radix's
                RadioGroup is exactly right — unlike the guest star control,
                where the same behaviour would file a rating. */}
            <RadioGroup
              value={String(threshold)}
              onValueChange={(value) => setThreshold(Number(value))}
              className="mt-2 flex items-center gap-2"
            >
              {THRESHOLDS.map((star) => (
                <div key={star} className="flex items-center">
                  <RadioGroupItem
                    id={`threshold-${star}`}
                    value={String(star)}
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor={`threshold-${star}`}
                    aria-label={`${star} stars and above`}
                    className="cursor-pointer rounded-lg px-2 py-1 text-[24px] leading-none text-muted-foreground/40 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-data-[state=checked]:text-foreground"
                  >
                    {star <= threshold ? '★' : '☆'}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {threshold} stars and up see the Google link. Everything below goes to your private
              feedback form.
            </p>
          </fieldset>

          <div>
            <Label
              htmlFor="page-destination"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Google review link
            </Label>
            <Input
              id="page-destination"
              value={destinationUrl}
              onChange={(event) => setDestinationUrl(event.target.value)}
              placeholder="https://g.page/r/…/review"
              aria-invalid={urlError}
              aria-describedby="page-destination-help"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p id="page-destination-help" className="mt-1 text-[12px] text-muted-foreground">
              {urlError
                ? 'Must start with https://'
                : 'Leave this empty and happy guests just see a thank-you.'}
            </p>
          </div>
        </div>
      </div>

      {page && (
        <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
            <h3 className="text-[13px] font-semibold text-foreground">Logo and QR</h3>
          </div>

          <div className="p-4 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => handleLogo(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              <Upload className="mr-2 h-4 w-4" />
              {page.logo_path ? 'Replace logo' : 'Upload logo'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQrOpen(true)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              <QrCode className="mr-2 h-4 w-4" />
              QR code
            </Button>
            <p className="w-full text-[12px] text-muted-foreground">
              PNG, JPEG, or WebP, up to 2 MB.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!canSave || isSaving}
          onClick={handleSave}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
        >
          {isSaving ? 'Saving…' : page ? 'Save' : 'Create page'}
        </Button>
      </div>

      {page && (
        <ReviewQrDialog
          open={qrOpen}
          onOpenChange={setQrOpen}
          slug={page.slug}
          publicUrl={`${window.location.origin}/r/${page.slug}`}
        />
      )}
    </div>
  );
}
```

The QR block uses `page.slug` — the saved one, not the field being typed into. A code generated from an unsaved slug would point at nothing.

- [ ] **Step 6: Write the page shell and the Pages tab**

Create `src/pages/Reviews.tsx`:

```tsx
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ChevronLeft, Plus, Star } from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useReviewPages, type ReviewPageWithStats } from '@/hooks/useReviewPages';
import { ReviewPageBuilder } from '@/components/reviews/ReviewPageBuilder';

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
```

`FeedbackTab` arrives in Task 9. Until then, add a temporary stub at the bottom of this file so the page compiles:

```tsx
function FeedbackTab({ restaurantId }: { restaurantId?: string; canManage: boolean }) {
  return <p className="text-[13px] text-muted-foreground">Coming in the next task.</p>;
}
```

- [ ] **Step 7: Add `PagesTab` to the same file**

```tsx
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
```

The status chip carries its own word — `Live` / `Paused` — rather than leaning on colour alone.

- [ ] **Step 8: Add the nav entry**

In `src/components/AppSidebar.nav.ts`, add `Star` to the `lucide-react` import list, then add the item to the `Main` group immediately after `/ops-inbox`:

```typescript
      { path: '/reviews', label: 'Reviews', icon: Star },
```

The sidebar filters itself through `allowedPathsForAreas`, which reads `routeAreas.ts` — the `{ path: '/reviews', area: 'reviews', minLevel: 'view' }` row added in Task 1 is what makes this entry appear for exactly the roles that hold `view:reviews`.

- [ ] **Step 9: Add the route**

In `src/App.tsx`, add the page import beside the other static page imports:

```tsx
import Reviews from "./pages/Reviews";
```

and the route immediately after the `/ops-inbox` route at `:356`:

```tsx
            <Route path="/reviews" element={<ProtectedRoute><Reviews /></ProtectedRoute>} />
```

- [ ] **Step 10: Verify the nav entry and the route in the browser**

```bash
npm run typecheck && npm run lint
```

Then start the preview (`preview_start` with the dev-server config), sign in as an owner, and confirm: `Reviews` appears in the Main group, `/reviews` renders the two tabs, the Pages tab shows the empty state, and creating a page moves the builder into edit mode with the QR button live. Check the console for errors and take a screenshot of the Pages tab at desktop width and at 375px to confirm the drill-in.

- [ ] **Step 11: Verify the QR library stayed out of the main chunk**

```bash
npm run build 2>&1 | grep -E "qrcode|index-" | head
```

Expected: a separate chunk containing `qrcode`. If `qrcode` appears inside `index-*.js`, the dynamic import was hoisted — check that nothing added a static `import QRCode from 'qrcode'` anywhere.

- [ ] **Step 12: Commit**

```bash
git add src/pages/Reviews.tsx src/components/reviews/ReviewPageBuilder.tsx src/components/reviews/ReviewQrDialog.tsx src/components/AppSidebar.nav.ts src/App.tsx package.json package-lock.json
git commit -m "feat(reviews): /reviews admin page with the page builder and QR export"
```

---
## Task 9: The Feedback tab

**Files:**
- Create: `src/lib/reviews/relativeTime.ts`
- Test: `tests/unit/relativeTime.test.ts`
- Create: `src/components/reviews/ReviewFeedbackDetail.tsx`
- Modify: `src/pages/Reviews.tsx` (replace the `FeedbackTab` stub from Task 8)

**Interfaces:**
- Consumes: `useReviewResponses`, `ReviewResponse`, `ReviewResponseContact`, `ReviewResponseStatus` (Task 7); `useReviewPages` for page names (Task 7); `useRestaurantClock` (existing, `formatInstant(value, pattern)`).
- Produces:
  - `formatRelativeTime(iso: string, nowMs: number): string`
  - `ReviewFeedbackDetail` props: `{ response: ReviewResponse; pageName: string; canManage: boolean; fetchContact: (id: string) => Promise<ReviewResponseContact | null>; onStatusChange: (status: ReviewResponseStatus) => void; onBack: () => void }`

- [ ] **Step 1: Write the failing relative-time test**

Create `tests/unit/relativeTime.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '@/lib/reviews/relativeTime';

const NOW = Date.parse('2026-08-04T12:00:00Z');

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(formatRelativeTime(ago(30_000), NOW)).toBe('just now');
  });

  it('reads minutes under an hour', () => {
    expect(formatRelativeTime(ago(45 * 60_000), NOW)).toBe('45m ago');
  });

  it('reads hours under a day', () => {
    expect(formatRelativeTime(ago(5 * 3_600_000), NOW)).toBe('5h ago');
  });

  it('reads days beyond that', () => {
    expect(formatRelativeTime(ago(3 * 86_400_000), NOW)).toBe('3d ago');
  });

  it('clamps a future timestamp to "just now" rather than printing a negative', () => {
    expect(formatRelativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/unit/relativeTime.test.ts 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `@/lib/reviews/relativeTime`.

- [ ] **Step 3: Write the helper**

Create `src/lib/reviews/relativeTime.ts`:

```typescript
/**
 * Coarse "how long ago" for inbox rows.
 *
 * Deliberately timezone-free: an elapsed duration is the same number of
 * minutes everywhere, so this needs no restaurant clock. The exact
 * wall-clock timestamp — which very much does need one — is rendered in the
 * detail pane through useRestaurantClock().formatInstant.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - Date.parse(iso));
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
```

- [ ] **Step 4: Run the test — green**

```bash
npx vitest run tests/unit/relativeTime.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Write the detail pane**

Create `src/components/reviews/ReviewFeedbackDetail.tsx`:

```tsx
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
          <p className="text-[20px] leading-none text-foreground" aria-label={`${response.rating} out of 5 stars`}>
            {'★'.repeat(response.rating)}
            <span className="text-muted-foreground/40">{'☆'.repeat(5 - response.rating)}</span>
          </p>
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
```

The timestamp is rendered through `formatInstant` with the zone abbreviation beside it — the convention established in `61e73fec`. A comment left at 9:40 pm in the dining room must read as 9:40 pm to the owner checking it from another state.

- [ ] **Step 6: Replace the `FeedbackTab` stub in `src/pages/Reviews.tsx`**

Add these imports at the top of the file:

```tsx
import { useReviewResponses, type ReviewResponse, type ReviewResponseStatus } from '@/hooks/useReviewResponses';
import { formatRelativeTime } from '@/lib/reviews/relativeTime';
import { ReviewFeedbackDetail } from '@/components/reviews/ReviewFeedbackDetail';
```

Then replace the stub function with:

```tsx
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
```

- [ ] **Step 7: Type-check, lint, and run the unit suites**

```bash
npm run typecheck && npm run lint && npx vitest run tests/unit/relativeTime.test.ts tests/unit/reviewMetrics.test.ts tests/unit/reviewSlug.test.ts
```

Expected: clean, 24 passed. In particular the lint run must not report a `no-restricted-syntax` violation — the detail pane formats through `useRestaurantClock`, and nothing here is added to the allowlist in `eslint.config.js:220-234`.

- [ ] **Step 8: Verify in the browser**

With the dev server running, sign in as an owner, submit a low rating with a comment through `/r/<slug>` in a private window, then open `/reviews` → Feedback. Confirm: the header counts move, the row appears with a `New` chip, the detail shows the timestamp with the restaurant's zone abbreviation, and changing the status to `Resolved` updates the chip. Then sign in as a Chef (`view:reviews` only) and confirm the contact block and the status control are both absent while the comment itself is readable. Screenshot the tab at desktop width and at 375px.

- [ ] **Step 9: Commit**

```bash
git add src/lib/reviews/relativeTime.ts tests/unit/relativeTime.test.ts src/components/reviews/ReviewFeedbackDetail.tsx src/pages/Reviews.tsx
git commit -m "feat(reviews): feedback inbox with metrics, detail pane, and status control"
```

---
## Task 10: End-to-end specs

**Files:**
- Create: `tests/e2e/review-stars.spec.ts`
- Create: `tests/e2e/review-funnel.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9. Produces nothing other tasks import.

**Two facts that shape both specs.** First, **edge functions are not served in the e2e stack** — `tests/e2e/open-shift-claim-approval.spec.ts:21-24` establishes the house pattern of intercepting `**/functions/v1/<name>` with `page.route` and asserting the client's request. `review-public` is stubbed the same way; its own logic is covered by the unit suites in Tasks 3 and 4. Second, nothing but the service role may INSERT into `review_responses` — that is the point of the RLS from Task 2 — so the inbox half of the funnel spec seeds its row by intercepting the PostgREST read, and asserts the status write on the wire.

- [ ] **Step 1: Write the star-control spec**

Create `tests/e2e/review-stars.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: the guest star control commits only on an explicit action.
 *
 * The ARIA radio pattern moves selection with focus. Here selection writes a
 * row and branches the page, so arrow keys must PREVIEW and nothing else.
 * This spec is the regression guard for that: if someone later swaps the
 * hand-rolled radiogroup for Radix's, the first assertion fails.
 *
 * The edge function is not served in the e2e stack, so `review-public` is
 * stubbed. Its routing and token logic are unit-tested separately; what this
 * proves is the wiring — which keystrokes reach the network and which don't.
 */

const FN_GLOB = '**/functions/v1/review-public';

test.describe('public review page star control', () => {
  test('arrow keys preview, Enter commits exactly one rating', async ({ page }) => {
    const rateBodies: any[] = [];

    await page.route(FN_GLOB, async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'page') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            restaurant_name: 'Test Diner',
            headline: 'How was everything?',
            subheadline: null,
            logo_url: null,
            threshold: 4,
          }),
        });
      }
      if (body.action === 'rate') {
        rateBodies.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'stub-token',
            routed_to: 'destination',
            destination_url: 'https://example.com/google-review',
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/r/table-tents');

    const group = page.getByRole('radiogroup', { name: /rate your visit/i });
    await expect(group).toBeVisible({ timeout: 10000 });

    await page.getByRole('radio', { name: '1 out of 5 stars' }).focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Focus has walked to star 5 and the preview says so...
    await expect(page.getByRole('radio', { name: '5 out of 5 stars' })).toBeFocused();
    // ...and not one byte has gone to the server.
    expect(rateBodies).toHaveLength(0);

    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible();
    expect(rateBodies).toHaveLength(1);
    expect(rateBodies[0]).toMatchObject({ action: 'rate', rating: 5, slug: 'table-tents' });
  });

  test('a promoter sees a Google button that is never followed automatically', async ({ page }) => {
    await page.route(FN_GLOB, async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'page') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            restaurant_name: 'Test Diner',
            headline: 'How was everything?',
            subheadline: null,
            logo_url: null,
            threshold: 4,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'stub-token',
          routed_to: 'destination',
          destination_url: 'https://example.com/google-review',
        }),
      });
    });

    await page.goto('/r/table-tents');
    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();

    const link = page.getByRole('link', { name: /leave a google review/i });
    await expect(link).toHaveAttribute('href', 'https://example.com/google-review');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // Still on our page: the guest chooses to leave, we never send them.
    expect(page.url()).toContain('/r/table-tents');
    await expect(page.getByRole('button', { name: /no thanks/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the star spec**

```bash
npx playwright test tests/e2e/review-stars.spec.ts --reporter=line
```

Expected: 2 passed. Playwright's own `webServer` block starts and stops the dev server, so there is no background process to trap or kill.

- [ ] **Step 3: Write the funnel spec — the owner half**

Create `tests/e2e/review-funnel.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: an owner builds a review page, a guest leaves private feedback on it,
 * and the owner works the note in the inbox.
 *
 * The page is created for real through the builder — `review_pages` is
 * writable by a manager under RLS. `review_responses` is not: only the
 * service role inserts there, which is exactly the isolation Task 2 buys.
 * The inbox half therefore serves its row from an intercepted PostgREST read
 * and asserts the status write on the wire, where the tenant filter is
 * visible. The guest half stubs `review-public`, which the e2e stack does not
 * serve.
 */

const FN_GLOB = '**/functions/v1/review-public';

test('owner creates a page, a guest comments, the owner resolves it', async ({ page, browser }) => {
  const user = generateTestUser('reviews');
  await signUpAndCreateRestaurant(page, user);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /new page/i }).first().click();

  const pageName = `Table tents ${Date.now()}`;
  await page.getByLabel(/^name$/i).fill(pageName);

  const slug = await page.getByLabel(/public link/i).inputValue();
  expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

  await page.getByLabel(/google review link/i).fill('https://example.com/google-review');
  await page.getByRole('button', { name: /create page/i }).click();

  // The card now exists, live, with the slug the guest will scan.
  await expect(page.getByText(`/r/${slug}`)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Live')).toBeVisible();

  await page.getByRole('button', { name: /qr code/i }).click();
  await expect(page.getByRole('button', { name: /download qr code as svg/i })).toBeEnabled({
    timeout: 10000,
  });
  await page.keyboard.press('Escape');
```

- [ ] **Step 4: Add the guest half in a second context**

Continue in the same test:

```typescript
  // A guest, in their own browser context — no session, no app chrome.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();

  const commentBodies: any[] = [];
  await guest.route(FN_GLOB, async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'page') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          restaurant_name: user.restaurantName,
          headline: 'How was everything?',
          subheadline: null,
          logo_url: null,
          threshold: 4,
        }),
      });
    }
    if (body.action === 'rate') {
      // Two stars is below the threshold: the server routes to feedback and
      // withholds the destination URL entirely.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'stub-token', routed_to: 'feedback' }),
      });
    }
    commentBodies.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await guest.goto(`/r/${slug}`);
  await guest.getByRole('radio', { name: '2 out of 5 stars' }).click();

  await expect(guest.getByRole('heading', { name: /what happened/i })).toBeVisible();
  await expect(guest.getByText(/straight to the owner/i)).toBeVisible();
  // No Google link on this branch, at all.
  await expect(guest.getByRole('link', { name: /google/i })).toHaveCount(0);

  await guest.getByLabel(/your feedback/i).fill('The wait was long and nobody said anything.');
  await guest.getByRole('button', { name: /send to the owner/i }).click();

  await expect(guest.getByRole('heading', { name: /thanks for telling us/i })).toBeVisible();
  expect(commentBodies).toHaveLength(1);
  expect(commentBodies[0]).toMatchObject({
    action: 'comment',
    token: 'stub-token',
    consent: false,
  });
  expect(commentBodies[0].comment).toContain('The wait was long');
  // Consent was never given, so no contact details left the browser.
  expect(commentBodies[0].name).toBeUndefined();
  expect(commentBodies[0].email).toBeUndefined();

  await guestContext.close();
```

- [ ] **Step 5: Add the inbox half and close the test**

```typescript
  const responseId = '11111111-1111-4111-8111-111111111111';
  let statusPatchUrl: string | null = null;

  await page.route('**/rest/v1/review_responses*', async (route) => {
    if (route.request().method() === 'PATCH') {
      statusPatchUrl = route.request().url();
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: responseId,
          restaurant_id: restaurantId,
          review_page_id: null,
          rating: 2,
          routed_to: 'feedback',
          comment: 'The wait was long and nobody said anything.',
          contact_consent: false,
          status: 'new',
          submitted_at: new Date().toISOString(),
          commented_at: new Date().toISOString(),
        },
      ]),
    });
  });

  await page.reload();
  await page.getByRole('button', { name: 'Feedback' }).click();

  // Exactly one row: silent ratings never reach this list.
  const rows = page.getByRole('button').filter({ hasText: 'The wait was long' });
  await expect(rows).toHaveCount(1);
  await rows.first().click();

  await expect(page.getByText('The wait was long and nobody said anything.').last()).toBeVisible();

  await page.getByRole('combobox', { name: /feedback status/i }).click();
  await page.getByRole('option', { name: 'Resolved' }).click();

  await expect.poll(() => statusPatchUrl, { timeout: 10000 }).not.toBeNull();
  // The tenant filter is on the wire, not merely trusted to RLS.
  expect(statusPatchUrl!).toContain(`id=eq.${responseId}`);
  expect(statusPatchUrl!).toContain(`restaurant_id=eq.${restaurantId}`);
});
```

- [ ] **Step 6: Run the funnel spec**

```bash
npx playwright test tests/e2e/review-funnel.spec.ts --reporter=line
```

Expected: 1 passed. If the builder's `New page` button is not found, check that the signed-up owner resolved to `manage:reviews` — that is Task 1's seed, and a failure here means the `role_areas` rows did not land.

- [ ] **Step 7: Run everything**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: type check clean, lint clean, the full Vitest suite green including the four new files from Tasks 3, 5, and 9.

```bash
npm run test:db
```

Expected: the pgTAP suites from Tasks 1 and 2 pass alongside the existing ones, including the amended `roles_schema_test.sql` and `roles_seed_test.sql`.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/review-stars.spec.ts tests/e2e/review-funnel.spec.ts
git commit -m "test(reviews): e2e coverage for the star control and the funnel"
```

---

## Deployment notes

Two secrets must exist before `review-public` will answer in any environment:

```bash
npx supabase secrets set REVIEW_TOKEN_SECRET="$(openssl rand -base64 48)"
npx supabase secrets set REVIEW_IP_PEPPER="$(openssl rand -base64 32)"
```

Rotating `REVIEW_TOKEN_SECRET` invalidates every in-flight token, which costs at most a 30-minute window of guests who rated but had not yet finished typing. Rotating `REVIEW_IP_PEPPER` resets rate-limit buckets; do both only when there is a reason.

The migration renumbers `area_catalog.sort_order`, so it must be applied before the frontend that reads the new ordering ships. Both go out in the same deploy.
