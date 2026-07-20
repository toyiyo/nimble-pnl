# Plan: keyset-batched bulk_process_historical_sales

**Design:** docs/superpowers/specs/2026-07-20-bulk-deduction-timeout-design.md
**Branch:** `fix/bulk-deduction-timeout`
**Migration file:** `supabase/migrations/20260720120000_bulk_deduction_keyset_batching.sql` (prefix verified unique vs `20260720000000`)

## Task breakdown (TDD, bite-sized)

### T1 — pgTAP test for the batched RPC (RED first)
- File: `supabase/tests/bulk_process_historical_sales_batching.sql`
- Seed: 1 restaurant + a `user_restaurants` row for the test role; 1 active recipe with `pos_item_name`; 1 recipe_ingredient → 1 product w/ stock; ~7 `unified_sales` rows in range **including two rows sharing the same `sale_date` AND `created_at`** (differ only by `id`) to prove the `id` tiebreaker.
- Assert:
  - `p_batch_size=3` → first call `batch_count=3`, `done=false`, non-null `next_cursor`.
  - Walking `next_cursor` across calls visits **every row exactly once**, no skip/dup at the shared-timestamp boundary.
  - Final short batch → `done=true`, `next_cursor=null`.
  - Exact-multiple case → one extra empty `done=true` call.
  - **Idempotency:** a full second pass reports `processed=0` (all `skipped`/already-processed); `inventory_transactions` count unchanged.
  - **Authz:** calling as a role/`p_restaurant_id` without a `user_restaurants` row `throws_ok('... Not authorized ...')`.
- Depends on T2 (function must exist to test). Author test + migration together; `npm run test:db` is the gate.

### T2 — Migration: batched function + indexes (GREEN)
- `DROP FUNCTION IF EXISTS public.bulk_process_historical_sales(uuid, date, date);`
- `CREATE OR REPLACE FUNCTION` 7-arg version per design §1: `SET search_path='public'`, `SET statement_timeout TO '120s'`, `user_has_restaurant_access` guard, sargable sentinel-COALESCE cursor, `ORDER BY sale_date, created_at, id LIMIT p_batch_size`, returns `{processed,skipped,errors,batch_count,done,next_cursor}`. Preserve existing processed/skipped counting + `EXCEPTION WHEN OTHERS` per-row + restaurant timezone lookup.
- Indexes per design §2: `DROP INDEX IF EXISTS idx_unified_sales_restaurant_date;` then `idx_unified_sales_restaurant_keyset`, `idx_inventory_transactions_dedup`, `idx_recipes_restaurant_pos_item_name` (partial), `idx_recipes_restaurant_name` (partial). GRANT comment.
- Verify `process_unified_inventory_deduction` 7-arg call signature matches current def.

### T3 — Unit test for the hook loop (RED first)
- File: `tests/unit/useBulkInventoryDeduction.test.ts`
- Mock `supabase.rpc` + `useQueryClient`. Assert:
  - rpc returns batch1 `{...,done:false,next_cursor:C}` then batch2 `{...,done:true,next_cursor:null}` → hook calls rpc twice, threads cursor C into 2nd call, accumulates totals, calls `onProgress` twice, returns summed totals, calls `invalidateQueries` once on success.
  - rpc error on batch2 → returns null, toast description includes partial `processed` count + "resumes"/"re-run", `invalidateQueries` still called.
  - `MAX_BATCHES` exceeded (always `done:false`) → throws/handled with cap message.

### T4 — Hook implementation (GREEN)
- Rewrite `src/hooks/useBulkInventoryDeduction.tsx` per design §3: `useQueryClient`, `BulkProgress` type, `onProgress?` param, batch loop, `MAX_BATCHES=1000`, invalidation on success + partial, partial-total error toast.
- Export `BulkProgress`.

### T5 — Dialog UI (Phase 5 UI review covers styling)
- `src/components/BulkInventoryDeductionDialog.tsx` per design §4:
  - `useState<BulkProgress|null>` progress; pass `onProgress={setProgress}` to the hook call.
  - Gate `onOpenChange` while `loading`; disable/hide Cancel while `loading`.
  - Live count in `<div role="status" aria-live="polite" className="text-[13px] text-muted-foreground">Processed {n} sales…</div>` inside the existing `<Alert>` block; keep `Loader2`.
  - Inline terminal totals before the 2s auto-close; reset progress on open/close.

### T6 — Sync generated types
- RPC arg/return shape changed. Run the `sync-types` skill (or `supabase gen types`) and commit `src/integrations/supabase/types.ts` if it drifts. Ensure `data` from rpc is typed/casted safely in the hook.

## Dependencies
- T1↔T2 land together (test + migration). T3→T4. T5 after T4. T6 after T2.
- Sequence: (T2+T1) → T6 → (T3+T4) → T5.

## Verify (Phase 8)
`npm run test:db` (pgTAP), `npm run test` (unit), `npm run typecheck`, `npm run lint`, `npm run build`. E2E only if a spec touches the Recipes bulk dialog.

## Out of scope / follow-ups
- `process_unified_inventory_deduction` tenant authz (spawned task task_76854bf3).
- Background-cron backfill variant (future, if page-close resilience needed).
