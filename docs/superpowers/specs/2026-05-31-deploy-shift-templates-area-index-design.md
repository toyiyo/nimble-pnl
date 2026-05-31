# Design: Fix broken Supabase deploy — area-aware shift_templates index + `--include-all`

**Date:** 2026-05-31
**Status:** Approved (design phase)
**Branch:** `fix/deploy-shift-templates-area-index`
**Severity:** Production — staffing overlay currently erroring; DB 2 migrations behind.

## Problem (two stacked root causes, confirmed on prod)

The `Deploy Supabase` workflow failed for #525 (`c09b8cd`) and #529 (`f330682`).

**(1) Out-of-order migration timestamp.** `supabase db push` (no `--include-all`)
refuses migrations older than the latest on remote. #527
(`20260529120000`, May 29) deployed first; #525's `20260528120000` (May 28) is now
older than remote → push aborts; #529 fails behind it. Prod's latest migration is
`20260529120000`; **`20260528120000` (#525) and `20260529130000` (#529) are NOT
applied** (verified via `supabase_migrations.schema_migrations` + absent
`sold_at` column / `uq_shift_templates_active_slot` index / `safe_cast_timestamptz`).

**(2) #525's unique index omits `area` — would fail even once unblocked.** Prod has
4 active-slot groups with identical `(restaurant_id, position, start_time, end_time,
days)` but **different `area`** ("Cold Stone" vs "Wetzel's" — a food-court operator).
`uq_shift_templates_active_slot` as written would throw a unique violation on this
real data. Verified: 4 dup groups *without* area, **0** dup groups *with* area.

**Impact:** #525/#529 frontends are already live (Netlify/Vercel deploy separately),
so prod UI references absent schema → staffing overlay `select(… sold_at …)` errors
and "Apply suggested shifts" upserts onto a missing index.

## Fix

1. **Make `uq_shift_templates_active_slot` area-aware** by editing the *unapplied*
   migration `20260528120000_shift_templates_idempotent_apply.sql`:
   ```sql
   DROP INDEX IF EXISTS public.uq_shift_templates_active_slot;
   CREATE UNIQUE INDEX uq_shift_templates_active_slot
     ON public.shift_templates (restaurant_id, position, start_time, end_time, days, (COALESCE(area, '')))
     WHERE is_active = true;
   ```
   `COALESCE(area,'')` keeps the index a no-NULL-escape-hatch (two area-NULL Apply
   shifts still conflict → idempotent), while area-named manager templates stay
   distinct. Verified safe against prod (0 exact dups incl. area).

   **Why edit the merged migration, not a follow-up:** under `--include-all` the
   broken `20260528120000` runs *first* and would fail before any later corrective
   migration. It has never reached any shared remote (prod doesn't have it), so
   editing it is safe; local/CI pick it up on `db:reset`.

2. **`supabase db push --include-all`** in `.github/workflows/deploy-supabase.yml`.
   Out-of-order merges are normal with parallel feature branches; `--include-all`
   is the standard CI setting to tolerate them. The migrations here are independent
   + idempotent, so order-independence is safe.

3. **Apply hook / `shiftBlocksToTemplates`:** no change needed — the upsert uses a
   bare `ignoreDuplicates: true` (ON CONFLICT DO NOTHING, no target), which works
   with the expression index; Apply-created templates have `area = NULL → ''`, so
   they're idempotent among themselves and distinct from named-area templates.
   (Confirm during build that the merged hook still uses bare `ignoreDuplicates`.)

## Testing

- **pgTAP** (`supabase/tests/38_shift_templates_idempotent_apply.sql`, update):
  area-distinct rows with identical position/time/days both insert (no collision);
  same `(…, area)` exact dup conflicts (DO NOTHING no-op); NULL-area Apply shifts
  idempotent.
- **Local verify:** `npm run db:reset && npm run test:db` green.
- **Deploy verify (post-merge):** prod `schema_migrations` includes `20260528120000`
  + `20260529130000`; `sold_at` column, `uq_shift_templates_active_slot` (area-aware),
  and `safe_cast_timestamptz` all present.

## Out of scope (follow-up)

- Systemic timestamp-at-merge discipline (the orchestrator picks a timestamp at
  *creation* relative to then-current main; a branch can still be leapfrogged).
  `--include-all` is the pragmatic safety net; a rebase-renumber step is the deeper fix.
