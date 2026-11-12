# Bank Reauth Notice: Name the Restaurant and Link to It

Date: 2026-11-12
Branch: `fix/bank-reauth-notice-restaurant`
Status: Draft (STE-aligned)

## 1. Problem

An owner of more than one restaurant got a bank reauth email for Chase (••5353).
The email did not name the restaurant. The "Go to Banking" button opened
`/banking`. The app then showed the last restaurant that the user selected
(Wetzel's). The Chase (••5353) account belongs to Russos Pizzeria. Thus the
Banking page showed no reconnect banner, and the user found no way to reconnect.

## 2. Facts About the Current Code

- The email and push copy come from `copyForStage`
  (`supabase/functions/_shared/bankReauthNoticeContent.ts:75-135`). No stage
  names the restaurant.
- The push URL is the fixed value `'/banking'`
  (`bankReauthNoticeContent.ts:90`, `bankReauthNoticeContent.ts:105`).
- The email button URL is `${appUrl}/banking`
  (`bankReauthNoticeContent.ts:139`, `bankReauthNoticeContent.ts:145`).
- `generateEmailTemplate` escapes the heading, the message, and the button text
  (`supabase/functions/_shared/emailTemplates.ts:158`, `:190`, `:192`).
- The cohort rows carry `restaurant_id` and `restaurant_timezone`, but no
  restaurant name (`supabase/functions/_shared/bankReauthNoticesHandler.ts:18-42`).
- `processTarget` does not give the restaurant id or a name to the content
  builder (`bankReauthNoticesHandler.ts:154-163`).
- The cohort RPCs join `public.restaurants r` and return `r.timezone`
  (`supabase/migrations/20260731020000_bank_reauth_cohort_restaurant_timezone.sql`).
  The worker calls them at `supabase/functions/bank-reauth-notices/index.ts:84`
  and `:92`.
- `RestaurantProvider` derives `selectedRestaurant` in a `useMemo`
  (`src/contexts/RestaurantContext.tsx:58-71`). The order is: the id in state,
  then the id in `localStorage`, then the only membership.
- `handleSetSelectedRestaurant` sets the state and `localStorage`
  (`RestaurantContext.tsx:105-112`).
- `RestaurantProvider` mounts inside `ProtectedRoute`, inside `BrowserRouter`
  (`src/App.tsx:150-175`, `src/App.tsx:353`). Thus router hooks work in the
  provider.
- The service worker opens `event.notification.data.url` on a push click
  (`public/sw.js:28-45`).
- No page in `src/` reads a `?restaurant=` query value today.
- A signed-out user goes to `/auth` with no return path (`src/App.tsx:160`).
  After sign-in, `Auth.tsx` goes to `/` (`src/pages/Auth.tsx:53-67`).

## 3. Goals

1. Each notice (email subject, email body, push) names the restaurant.
2. The email button and the push link open Banking for that restaurant.

## 4. Non-Goals

- No alert in the restaurant switcher for other restaurants.
- No change to the escalation stages or to the recipients.
- No grouping of several accounts into one notice.
- No return path through sign-in. A signed-out user still lands on `/` after
  sign-in. The notice names the restaurant, so the user can select it.
  See §7.

## 5. Design

### 5.1 Database: return the restaurant name

Add one migration. It drops and creates `bank_reauth_cohort_a_candidates()` and
`bank_reauth_cohort_b_recovered()` again. The body stays the same as in
`20260731020000_bank_reauth_cohort_restaurant_timezone.sql`, with one more
output column: `restaurant_name text` from `r.name`.

Keep these properties from the earlier migration:

- `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
- `GRANT EXECUTE ... TO service_role`.
- The `LEFT JOIN public.restaurants r`. A missing row gives a null name.

The return type changes, so `CREATE OR REPLACE` is not sufficient. Use
`DROP FUNCTION` and `CREATE FUNCTION` in one transaction, as the earlier
migration does.

### 5.2 Worker: pass the id and the name

In `bankReauthNoticesHandler.ts`:

- Add `restaurant_name?: string | null` to `CohortARow` and `CohortBRow`.
- Add `restaurantName?: string | null` to `NoticeTarget`.
- Map the column in both cohort loops.
- Give `restaurantId` and `restaurantName` to `buildBankReauthNoticeContent`.

### 5.3 Content: name the restaurant and link to it

Add two fields to `BankReauthNoticeInput`:

- `restaurantId: string` (required).
- `restaurantName?: string | null`.

Rules:

- Trim the name. If the result is empty, use no name.
- With a name, the email subject starts with `<name>: `.
  Example: `Russos Pizzeria: Reconnect Chase — bank sync paused`.
- With a name, the message names the restaurant.
  Example: `Chase (••5353) at Russos Pizzeria ended its connection ...`.
- With a name, the push title starts with `<name>: `.
  Example: `Russos Pizzeria: Chase needs reconnecting`.
- With no name, the copy stays the same as today.
- The banking path is `/banking?restaurant=<encodeURIComponent(restaurantId)>`.
  The push `url` is this path. The email button URL is `appUrl` plus this path.
- The `recovered` email also uses this path. The user can check the account
  for the correct restaurant.

The template escapes all text, so a name with `<` or `&` is safe in HTML.

### 5.4 Frontend: select the restaurant from the link

In `RestaurantProvider` (`src/contexts/RestaurantContext.tsx`):

1. Read `restaurant` from `useSearchParams()`.
2. In the `selectedRestaurant` memo, put `byId(linkedRestaurantId)` first.
   The memo selects the linked restaurant in the first render. This keeps the
   rule in the comment at `RestaurantContext.tsx:45-57`: no commit with a
   wrong or null selection.
3. In an effect: when the linked id matches a membership, call
   `handleSetSelectedRestaurant` with it. Then remove the `restaurant` key from
   the URL with `setSearchParams(..., { replace: true })`. Keep all other keys.
4. When the linked id matches no membership, ignore it and remove the key.
   Do not remove the key while `restaurants` is still loading.

A user can select only a restaurant where the user has a membership. RLS
does not change. The link gives no new access.

The logic goes into one small pure function so that a unit test can cover it:
`resolveLinkedRestaurant(linkedId, restaurants)` returns the membership or null.

## 6. Tests

| Layer | File | Cases |
|-------|------|-------|
| pgTAP | `supabase/tests/bank_reauth_notices.sql` | Both RPCs return `restaurant_name`. |
| Unit | `tests/unit/bankReauthNoticeContent.test.ts` | Name in subject, message, push title for each stage. No name gives the old copy. Blank name gives the old copy. URL has `?restaurant=<id>` for email and push. Id is URL-encoded. |
| Unit | `tests/unit/bankReauthNoticesHandler.test.ts` | Handler passes `restaurant_id` and `restaurant_name` from cohort A and cohort B. |
| Unit | `tests/unit/restaurantDeepLink.test.ts` (new) | `resolveLinkedRestaurant`: match, no match, null id, empty list. |
| Unit | `tests/unit/RestaurantContext.deepLink.test.tsx` (new) | `/banking?restaurant=B` with saved A selects B, saves B, removes the key. A foreign id keeps A and removes the key. |
| E2E | `tests/e2e/banking-restaurant-deep-link.spec.ts` (new) | A user with two restaurants opens `/banking?restaurant=<second>`. The switcher shows the second restaurant and the URL has no `restaurant` key. |

## 7. Risks

- **Signed-out click.** The link loses `?restaurant=` at the `/auth` redirect.
  The user then must select the restaurant by hand. The notice names it. A
  general return path through sign-in touches every protected route, so it is
  a separate task.
- **Stale push in the field.** Pushes sent before the deploy still open
  `/banking`. The behavior for them stays the same as today.
- **Deploy order.** The worker reads `restaurant_name` as optional. If the
  function deploys before the migration, the copy has no name, but the link
  works. Apply the migration first.
