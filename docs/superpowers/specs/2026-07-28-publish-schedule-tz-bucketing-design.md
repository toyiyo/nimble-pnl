# `publish_schedule` / `unpublish_schedule` bucket shifts in the session timezone, not the restaurant's

**Date:** 2026-07-28
**Branch:** `fix/publish-schedule-tz-bucketing`
**Status:** Approved

## Problem

`publish_schedule` and `unpublish_schedule`
(`supabase/migrations/20251123000000_schedule_publishing.sql`) select the shifts a
week owns with a bare cast:

```sql
AND start_time::date >= p_week_start
AND start_time::date <= p_week_end
```

`shifts.start_time` is `timestamptz`. Casting a `timestamptz` to `date` resolves
against the **database session** `TimeZone` GUC, not the restaurant's IANA zone.
No migration in this repo sets a non-default `TimeZone`, so on Supabase this is
UTC.

For a restaurant behind UTC — `America/Chicago`, UTC−5 in summer — a closing
shift that starts at 22:00 local has a `start_time` whose **UTC** calendar day is
already the next day. Its restaurant-local day and its UTC day disagree for the
five hours between 19:00 local and local midnight, which is exactly when closing
shifts start.

Two failures follow, one at each end of the week:

| Shift (America/Chicago) | Local day | UTC day | Belongs to week? | Current behavior |
|---|---|---|---|---|
| Sun 22:00 (`p_week_end`) | Sunday | next Monday | yes | **excluded** — never published |
| Sun 22:00 (`p_week_start − 1`) | prior Sunday | Monday = `p_week_start` | no | **included** — published with the wrong week |

East of UTC the slip mirrors: for `Asia/Tokyo` (UTC+9) a 06:00 Monday opening
shift is 21:00 Sunday in UTC, so it falls *before* `p_week_start` and is skipped.

This is independent of the JS-layer off-by-one fixed on
`fix/publish-week-tz-offbyone`, and was recorded there as tracked non-goal #2
(`docs/superpowers/specs/2026-07-27-publish-week-tz-offbyone-design.md`). That
doc's first draft claimed the SQL was "correct"; the claim was withdrawn. This
change discharges the follow-up.

### The correct pattern already exists next door

`get_open_shifts` — same code family, same tables — resolves the restaurant zone
into `v_tz` and buckets with it:

```sql
SELECT COALESCE(r.timezone, 'UTC') INTO v_tz
FROM public.restaurants r WHERE r.id = p_restaurant_id;
...
(s.start_time AT TIME ZONE v_tz)::date
```

That snippet is a composite of two migrations, not one continuous excerpt: the
`COALESCE` resolution is
`20260721140000_open_shift_claim_authz_guard.sql:92-95`, the bucketing expression
is `20260529120000_fix_open_shifts_capacity_one.sql:107-109`.

So `get_open_shifts` and `publish_schedule` disagree today about which shifts a
week contains — the read path is restaurant-local, the write path is UTC.

## Approaches considered

**A — Re-declare both functions with the `v_tz` pattern.** *(chosen)*
Matches the established convention in the same code family, fixes both ends of
the boundary, and makes the publish path agree with the read path. Signature,
return type, and volatility are unchanged, so no client change and no `DROP`.

**B — Set a per-function `SET TimeZone = <restaurant tz>`.**
Rejected: `SET` clauses on a function take a constant, not a per-call value, so
this cannot express "the caller's restaurant." A `SET LOCAL` inside the body
would work but leaks the zone into every other expression in the function
(`NOW()`, the change-log timestamps), changing more semantics than intended.

**C — Compare against `timestamptz` bounds computed from the dates.**
`start_time >= (p_week_start::timestamp AT TIME ZONE v_tz)` and `< (p_week_end +
1)::timestamp AT TIME ZONE v_tz`. Sargable — it could use an index on
`start_time`, which `(start_time AT TIME ZONE v_tz)::date` cannot. Rejected for
now: it is a *different* expression from the one `get_open_shifts` uses, so the
read and write paths would still be textually divergent and could drift again;
and there is no index on `shifts(restaurant_id, start_time)` today for it to
exploit, so the win is hypothetical. Consistency with the sibling wins. Recorded
here so a future indexing pass knows the option exists.

## Design

### Migration — `supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql`

**Provenance.** `grep -rlE "FUNCTION\s+(public\.)?(publish_schedule|unpublish_schedule)\b" supabase/migrations/`
returns exactly one file: `20251123000000_schedule_publishing.sql`. It is both
the original and the latest definition, so the bodies are copied from there. The
migration header records this, per the 2026-07-22 lesson — a `CREATE OR REPLACE`
is a full-body rewrite and silently reverts anything it does not carry forward.

This migration lands at `20260729120000`. It was originally written as
`20260728140000`, but PR #673 merged `20260728140000_search_pos_items.sql` to
`main` while this branch was open, and CI — which builds the *merge* ref, not
the branch tip — caught the collision: `migrationVersionUniqueness` failed, and
`supabase start` failed in every DB job downstream of it. A local
`ls supabase/migrations | uniq -d` stayed clean throughout, because the
colliding file was never on this branch. The check that matters is against the
merged set, re-run immediately before every push, not once at authoring time.

**Timezone resolution.** Both functions gain, verbatim from the deployed sibling
`20260723180000_timeoff_conflict_local_tz.sql`:

```sql
DECLARE
  v_tz TEXT;
BEGIN
  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  -- Probe the zone once. An invalid IANA string raises invalid_parameter_value
  -- (22023) on first use; without this the whole publish would abort. The
  -- handler reassigns v_tz itself so every downstream reference is safe.
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;
```

The probe is a third variant of the sibling convention: `20260723180000` and
`20260724120000` wrap their *production* casts in the `EXCEPTION` block, because
each has a single cast to guard. Here there are three casts across two functions,
so the block guards a throwaway expression instead. This is sound —
`invalid_parameter_value` depends only on the zone string, not on the
`timestamptz` being converted, so `now()` raises exactly when `s.start_time`
would. It requires that the whole resolution block precede **every** later use of
`v_tz`: the count and the `UPDATE` in `publish_schedule`, and the `UPDATE` in
`unpublish_schedule`. PL/pgSQL puts it at the top of the body, so this is
mechanical, but it is the thing to check when reviewing the migration.

`NULLIF` covers an empty string; the `SELECT ... INTO` leaving `v_tz` NULL (no
such restaurant) is covered by the same `COALESCE`. The fallback zone is `'UTC'`,
matching `get_open_shifts` and the TypeScript `computeOpenShiftCount` path.

**Bucketing.** Three bare casts are replaced — the count and the update in
`publish_schedule`, the update in `unpublish_schedule`:

```sql
AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
```

`timestamptz AT TIME ZONE '<zone>'` yields a `timestamp` reading as wall-clock in
that zone; `::date` then gives the restaurant-local calendar day. Identical to
`get_open_shifts`.

**Hardening carried along.** A re-declaration is the right moment to add these,
per the 2026-07-20 lesson:

- `SET search_path = public, pg_temp` on both. Both are `SECURITY DEFINER` with a
  mutable search_path today — a Supabase security-advisor lint and a real (if
  low) definer-rights vector.
- Table references schema-qualified to `public.`, so resolution does not depend
  on the pinned path.
- `SECURITY DEFINER` restated explicitly. `CREATE OR REPLACE` does not carry it
  forward.
- **`EXECUTE` privilege boundary** (added after the Phase 2.5 review — see
  *Design review* below):

  ```sql
  REVOKE ALL ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) TO authenticated, service_role;
  ```

  and the same pair for `unpublish_schedule(UUID, DATE, DATE, TEXT)`. Neither
  function has ever had a `GRANT`/`REVOKE`, so both still carry Postgres's
  default `PUBLIC EXECUTE` — and both are `SECURITY DEFINER`, which bypasses RLS.
  An unauthenticated caller holding only the publishable key can therefore
  publish-and-lock or unpublish any restaurant's week today. Removing `anon`
  costs nothing: the only callers are `src/hooks/useSchedulePublish.tsx`
  (browser, authenticated) and the E2E spec, which signs in; no edge function
  calls either RPC (`grep -rn "publish_schedule" src supabase/functions tests`).
  Every comparable definer RPC in this repo already carries this boundary —
  `20260723170000_link_invited_employee.sql:165-166` is the template.

Everything else is copied unchanged: signatures, return types, `auth.uid()`
attribution, the `schedule_publications` insert, `GET DIAGNOSTICS ROW_COUNT`, and
the `schedule_change_logs` entry.

### Not changed

- **No in-body authorization guard.** Neither function checks that the caller
  belongs to `p_restaurant_id`, so any *authenticated* user can still publish or
  unpublish any restaurant's week by passing a foreign UUID. The `EXECUTE`
  boundary above closes the anonymous half of this and is in scope; the identity
  check is not. It needs a decision about which roles may publish (owner and
  manager, presumably, not staff), it touches the shared
  `user_has_restaurant_access`-style helper surface, and it is the kind of change
  that should be reviewable on its own rather than buried under a date-bucketing
  fix. **Tracked follow-up, and the more serious half of the exposure** — a
  short-lived gap, since the `authenticated` role is reachable by anyone who can
  sign up.
- **`get_open_shifts`.** Already correct; this change makes the write path agree
  with it.
- **Existing rows.** No backfill. A shift wrongly published under the old
  bucketing stays published until someone unpublishes that week — at which point
  the corrected `unpublish_schedule` will also decline to touch the neighbouring
  week's late-night shift it should never have owned. Publishing is a repeatable
  manager action, so no migration-time repair is warranted.
- **Frontend.** No TypeScript, hook, or UI change. The RPC signature is
  identical.
- **`useWeekPublicationStatus`'s browser-local week anchor.** The hook
  (`src/hooks/useSchedulePublish.tsx`) gates "is this week published" on a
  `shifts` count bounded by `weekStart.toISOString()`..`weekEnd.toISOString()`.
  Post-#671 those are full instants, so a viewer *in the restaurant's own
  timezone* agrees with the corrected RPC: a Sun 22:00 America/Chicago shift
  (Mon 03:00 UTC) still falls under `endOfWeek` = Sun 23:59:59.999 CDT =
  Mon 04:59:59.999 UTC. The two disagree only for a viewer in a *different*
  zone than the restaurant, which is exactly non-goal #1 recorded in
  `2026-07-27-publish-week-tz-offbyone-design.md:306` — the week boundary is
  anchored to the viewer, not the restaurant. This change does not introduce
  that mismatch, but it does make it observable in one more place: a
  cross-timezone manager whose week contains *only* a boundary late-night shift
  would see the week reported unpublished despite a real `schedule_publications`
  row. Closing it means threading the restaurant timezone through the shared
  week anchor (`useSharedWeek`, `useShifts`, the grid, and the
  `week_start_date`/`week_end_date` lookup), which is the tracked follow-up —
  not something to bury under a date-bucketing migration.

### Incidental fix

`tests/e2e/broadcast-open-shifts.spec.ts:74` carries the comment "The
publish_schedule RPC uses start_time::date which compares local date." That was
false when written (it compared the *session* date, i.e. UTC) and is the reason
the spec deliberately seeds a noon shift to dodge the boundary. The comment is
corrected to describe restaurant-local bucketing; the noon seed stays, since that
spec is testing broadcast, not the boundary.

## Testing

### pgTAP — `supabase/tests/publish_schedule_tz_bucketing.test.sql`

**Date anchoring.** The anchor is the next Monday computed from `CURRENT_DATE`
(`CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)`), never a
literal date — the 2026-04-21 lesson. Shift instants are built by converting a
local wall-clock into an instant, `(<local timestamp>) AT TIME ZONE
'America/Chicago'`, rather than hardcoding a UTC offset, so the fixtures stay
correct across the CST/CDT transition.

**Auth context.** `publish_schedule` writes `published_by = auth.uid()` into
`schedule_publications.published_by`, which is `NOT NULL` (the same-named column
on `shifts` is nullable and is not the constraint that bites), `unpublish_schedule` writes `changed_by = auth.uid()`, and the
`log_shift_change` trigger does the same on every update to a published shift.
Run as bare `postgres`, `auth.uid()` is NULL and all three violate `NOT NULL`. The
test therefore sets `request.jwt.claims` via `set_config(..., true)` — which is
what `auth.uid()` actually reads, and is role-independent, so the test stays as
`postgres` and avoids the `authenticated`-role privilege problems documented in
the 2026-07-22 lesson.

**Fixtures.** Three restaurants: `America/Chicago` (behind UTC),
`Asia/Tokyo` (ahead), and one carrying a deliberately invalid IANA string.

**Assertions.** For `America/Chicago`, week = anchor Monday .. anchor Monday + 6:

| Shift | Local start | UTC calendar day | Expected |
|---|---|---|---|
| control | Mon (`week_start`) 10:00 | same Monday | published |
| **upper edge** | Sun (`week_end`) 22:00 | following Monday | **published** |
| **lower edge** | Sun (`week_start − 1`) 22:00 | Monday = `week_start` | **not published** |

The lower edge is what makes the suite non-vacuous: a "fix" that merely widened
the upper bound would still fail it. Both edges are asserted again for
`unpublish_schedule` (upper-edge shift returns to unpublished; lower-edge shift,
which belongs to the neighbouring week, is left alone), and the `shift_count`
persisted on the `schedule_publications` row is checked so the count and the
update cannot drift apart.

For `Asia/Tokyo`, the mirror image: a 06:00 Monday opening shift on `week_start`
(21:00 Sunday UTC) must be published, and the 06:00 Monday shift on `week_end +
1` (21:00 Sunday UTC on `week_end`) must not be.

For the invalid-timezone restaurant, `publish_schedule` must return a publication
id rather than raising, and must bucket as if UTC — pinning the `EXCEPTION`
fallback.

**Privilege assertions.** Two `has_function_privilege` checks pin the new
`EXECUTE` boundary — `anon` must not hold it, `authenticated` must. These are
catalog assertions, so they hold even though the suite itself runs as `postgres`
and bypasses grant enforcement.

**Migration application.** The suite is run after `npm run db:reset`, not against
the already-running database — the 2026-07-13 lesson. `npm run test:db` does not
apply migrations.

### E2E

No E2E is added. The Phase 8 coverage gate asks for one when a change alters a
user-facing flow or a cross-layer seam; this change alters neither. There is no
route, dialog, component, hook, or RPC-signature change, and the publish flow the
existing `tests/e2e/broadcast-open-shifts.spec.ts` drives behaves identically for
its noon-local fixture. The behavior that *did* change is a date-bucketing
predicate inside two SQL functions, and pgTAP exercises it at exactly that
boundary with fixtures an E2E could not express more precisely — a Playwright
spec would have to seed a non-UTC restaurant and a 22:00 shift and then assert on
`shifts.is_published` through the database anyway, reproducing the pgTAP
assertions with more moving parts.

### Regression risk on the existing suite

`grep -rln "publish_schedule" supabase/tests/ tests/` returns only
`tests/e2e/broadcast-open-shifts.spec.ts`, which seeds a Monday-noon shift —
noon is unambiguous in every zone this repo targets, so its behavior is
unchanged. No pgTAP suite calls these RPCs today.

## Risks

- **A late-night shift changes weeks.** That is the fix. A manager who published
  a week under the old behavior and republishes after this deploys may see one
  closing shift move between weeks. It moves to the correct week.
- **`AT TIME ZONE` is not sargable**, so the predicate cannot use an index on
  `start_time`. Neither could the previous `start_time::date`, and no such index
  exists; the scan is already restaurant-scoped. No regression. Approach C above
  records the sargable alternative if this ever becomes hot.
- **`SET search_path` on a `SECURITY DEFINER` function is a behavior change** if
  any reference resolved through a different schema before. All references are
  schema-qualified in the new body, and `pg_catalog` is always searched first, so
  unqualified built-ins (`now()`, `auth.uid()`) still resolve. The full pgTAP
  suite is the check.
- **Revoking `anon` could break an unknown caller.** The grep above covers this
  repo; anything calling these RPCs with the publishable key from outside it
  would start getting a permission error. No such integration is known, and an
  anonymous publish is not a capability worth preserving.

## Design review

Reviewed in Phase 2.5 by `supabase-design-reviewer` against the committed doc.

**Critical — accepted, scope widened.** The reviewer found that neither function
has ever had a `GRANT`/`REVOKE`, so both still carry the default `PUBLIC EXECUTE`
while being `SECURITY DEFINER` — an anonymous cross-tenant write path, and an
outlier against a convention every comparable RPC in this repo follows. It also
correctly pointed out that this design's reason for punting on authorization
(that a guard makes existing pgTAP calls vacuous) does not apply to the *privilege*
half: there are no existing pgTAP suites for these RPCs to invalidate, the new
suite runs as `postgres`, and the migration re-declares both functions anyway. The
`REVOKE`/`GRANT` pair is now in scope, with two `has_function_privilege`
assertions. The in-body identity check stays out of scope, for the reasons under
*Not changed*.

This widens what the approved design covered. It is additive, it does not change
the bucketing fix, and it is a security boundary rather than a refactor — but it
is a deviation, and it is called out here rather than folded in silently.

**Three minor findings — all applied to this doc:** the `get_open_shifts` snippet
is now labelled as a composite of two migrations; the `NOT NULL` column is now
named as `schedule_publications.published_by`; the `PERFORM now()` probe is now
documented as a deliberate third variant of the sibling convention, with the
"resolution block must precede every use of `v_tz`" check written down.

**Independently verified by the reviewer:** the sole-definer provenance, the
`AT TIME ZONE` direction and both worked boundary tables, the `pg_temp`-last
search_path form, the `set_config('request.jwt.claims', ...)` auth mechanic, the
non-vacuousness of the lower/upper edge pair, the migration prefix collision, the
`restaurants.timezone` nullability, and the stale E2E comment.
