# Bank Reauth Notice: Name the Restaurant and Link to It

Date: 2026-11-12
Branch: `fix/bank-reauth-notice-restaurant`
Status: Reviewed (STE-aligned)

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
  The email subject and the push title are plain text, not HTML.
- The cohort rows carry `restaurant_id` and `restaurant_timezone`, but no
  restaurant name (`supabase/functions/_shared/bankReauthNoticesHandler.ts:18-42`).
- `processTarget` does not give the restaurant id or a name to the content
  builder (`bankReauthNoticesHandler.ts:154-163`).
- The cohort RPCs join `public.restaurants r` and return `r.timezone`
  (`supabase/migrations/20260731020000_bank_reauth_cohort_restaurant_timezone.sql`).
  That file also sets `COMMENT ON FUNCTION` for each RPC. No later migration
  changes these RPCs. The worker calls them at
  `supabase/functions/bank-reauth-notices/index.ts:84` and `:92`.
- `RestaurantProvider` derives `selectedRestaurant` in a `useMemo`
  (`src/contexts/RestaurantContext.tsx:58-71`). The order is: the id in state,
  then the id in `localStorage`, then the only membership. The comment at
  `RestaurantContext.tsx:45-57` explains why this is a memo, not an effect.
- `handleSetSelectedRestaurant` sets the state and `localStorage`
  (`RestaurantContext.tsx:105-112`).
- Each `ProtectedRoute` mounts its own `RestaurantProvider`, inside
  `BrowserRouter` (`src/App.tsx:150-175`, `src/App.tsx:353`). Router hooks work
  in the provider. The state resets on each route change, so only
  `localStorage` keeps a choice across routes.
- The shift-trade link already uses a `restaurant` query key.
  `TRADE_LINK_PARAMS = ['trade','restaurant','from']`
  (`supabase/functions/_shared/tradeDeepLinkUrl.ts:12-13`).
  `src/hooks/useTradeDeepLink.ts:60-87` reads these keys, selects the
  restaurant, and deletes the keys from the URL.
- `tests/unit/RestaurantContext.roleResolution.test.tsx:77-80` renders the real
  `RestaurantProvider` with no Router.
- The service worker opens `event.notification.data.url` on a push click
  (`public/sw.js:28-45`).
- A signed-out user goes to `/auth` with no return path (`src/App.tsx:160`).
  After sign-in, `Auth.tsx` goes to `/` (`src/pages/Auth.tsx:53-67`).
- `useRestaurants` sets `loading` to false with an empty list when the fetch
  fails (`src/hooks/useRestaurants.tsx:163-167`).

## 3. Goals

1. Each notice (email subject, email body, push) names the restaurant.
2. The email button and the push link open Banking for that restaurant.

## 4. Non-Goals

- No alert in the restaurant switcher for other restaurants.
- No change to the escalation stages or to the recipients.
- No grouping of several accounts into one notice.
- No change to the shift-trade link.
- No return path through sign-in. See §7.

## 5. Design

### 5.1 Database: return the restaurant name

Add the migration
`supabase/migrations/20261112120000_bank_reauth_cohort_restaurant_name.sql`.
It drops and creates `bank_reauth_cohort_a_candidates()` and
`bank_reauth_cohort_b_recovered()` again. The body stays the same as in
`20260731020000_bank_reauth_cohort_restaurant_timezone.sql`, with one more
output column: `restaurant_name text` from `r.name`.

Keep these properties from the earlier migration:

- `STABLE`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
- `GRANT EXECUTE ... TO service_role`.
- The `LEFT JOIN public.restaurants r`. A missing row gives a null name.
- Both `COMMENT ON FUNCTION` statements. Add the restaurant name to the text.

The return type changes, so `CREATE OR REPLACE` is not sufficient. Put the
`DROP FUNCTION` and `CREATE FUNCTION` statements in one migration file. The
migration runner runs the file in one transaction.

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

Clean the name with a pure function `cleanRestaurantName(name)`:

- Change each run of whitespace and control characters (CR, LF, tab) to one
  space. Then trim.
- Cut the name to 60 characters. Add `…` when the function cuts it.
- Return null for an empty result.

Copy rules:

- With a name, the email subject starts with `<name>: `.
  Example: `Russos Pizzeria: Reconnect Chase — bank sync paused`.
- With a name, the message names the restaurant.
  Example: `Chase (••5353) at Russos Pizzeria ended its connection ...`.
- With a name, the push title starts with `<name>: `.
  Example: `Russos Pizzeria: Chase needs reconnecting`.
- With no name, the copy stays the same as today.

Link rules:

- The banking path is
  `/banking?select_restaurant=<encodeURIComponent(restaurantId)>`.
- The push `url` is this path. The email button URL is `appUrl` plus this path.
- The `recovered` email also uses this path.

The key `select_restaurant` is new. It does not clash with the trade link key
`restaurant`.

### 5.4 Frontend: select the restaurant from the link

Add `src/lib/restaurantDeepLink.ts` with pure functions:

- `SELECT_RESTAURANT_PARAM = 'select_restaurant'`.
- `readLinkedRestaurantId(searchParams)` returns the value or null.
- `resolveLinkedRestaurant(linkedId, restaurants)` returns the membership
  with that id, or null.
- `withoutLinkedRestaurant(searchParams)` returns a new `URLSearchParams` with
  all keys except `select_restaurant`.

In `RestaurantProvider` (`src/contexts/RestaurantContext.tsx`):

1. Read `select_restaurant` with `useSearchParams()`.
2. In the `selectedRestaurant` memo, put
   `resolveLinkedRestaurant(linkedId, restaurants)` first. The memo selects the
   linked restaurant in the same render where `loading` clears. Thus no
   commit has a wrong or null selection, and no query runs for the wrong
   restaurant. The comment at `RestaurantContext.tsx:45-57` stays true.
3. In an effect, with `linkedId` in the deps:
   - Do nothing while `loading` is true.
   - Do nothing when `restaurants` is empty. A failed fetch gives an empty
     list. A later refetch can still use the key.
   - When the id matches a membership, call `handleSetSelectedRestaurant`.
     This writes `localStorage`, so the provider on the next route keeps the
     choice.
   - Then call `setSearchParams(withoutLinkedRestaurant(searchParams),
     { replace: true })`. All other keys stay, for example `welcome=true`.
   - When the id matches no membership, ignore it and delete the key.
   - Use a ref guard so that a StrictMode double effect does not run the
     write two times.
4. No loop occurs. After the key is deleted, `linkedId` is null and the effect
   does nothing.

A user can select only a restaurant where the user has a membership. RLS does
not change. The link gives no new access. A staff or kiosk user at the linked
restaurant goes to the usual page through the existing guards
(`src/App.tsx:300-343`). This is intended.

## 6. Tests

| Layer | File | Cases |
|-------|------|-------|
| pgTAP | `supabase/tests/bank_reauth_notices.sql` | Change `plan(29)` to `plan(37)`. Add: cohort A and cohort B return `restaurant_name` equal to `restaurants.name` (2). For both RPCs: `anon` and `authenticated` have no `EXECUTE`, and `service_role` has it (6). |
| Unit | `tests/unit/bankReauthNoticeContent.test.ts` | Add `restaurantId` to `BASE`. Name in subject, message, push title for each stage. No name and blank name give the old copy. URL has `?select_restaurant=<id>` for email and push. Id is URL-encoded. `cleanRestaurantName`: CR/LF, long name, blank. |
| Unit | `tests/unit/bankReauthNoticesHandler.test.ts` | Handler passes `restaurant_id` and `restaurant_name` from cohort A and cohort B. |
| Unit | `tests/unit/restaurantDeepLink.test.ts` (new) | Read, resolve (match, no match, null id, empty list), and delete the key with other keys kept. |
| Unit | `tests/unit/RestaurantContext.roleResolution.test.tsx` | Wrap the `wrapper` in `MemoryRouter`. Add: with a linked id, no sample has `loading: false` and `role === undefined`. |
| Unit | `tests/unit/RestaurantContext.deepLink.test.tsx` (new) | Saved A plus `?select_restaurant=B` selects B, saves B, deletes the key. A foreign id keeps A and deletes the key. `?select_restaurant=B&welcome=true` keeps `welcome=true`. An empty list keeps the key. `?trade=T&restaurant=B&from=reminder` does not change the URL or the selection. |
| E2E | `tests/e2e/banking-restaurant-deep-link.spec.ts` (new) | Add helper `addSecondRestaurant` to `tests/helpers/e2e-supabase.ts`. A user with two restaurants opens `/banking?select_restaurant=<first>` while the second is selected. The restaurant switcher trigger shows the first name. The URL has no `select_restaurant` key. `localStorage` holds the first id after a reload. |

## 7. Risks

- **Signed-out click.** The link loses `?select_restaurant=` at the `/auth`
  redirect. The user then must select the restaurant by hand. The notice names
  it. A general return path through sign-in touches every protected route, so
  it is a separate task.
- **Old pushes and emails.** Notices sent before the deploy still open
  `/banking`. The behavior for them stays the same as today.
- **Deploy order.** The worker reads `restaurant_name` as optional. If the
  function deploys before the migration, the copy has no name, but the link
  works. Apply the migration first.
