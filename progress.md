# Progress: Invoice importer — read "pack" (inner count) instead of "size" as quantity

## Spec
- Design: docs/superpowers/specs/2026-07-02-invoice-pack-quantity-design.md
- Plan:   docs/superpowers/plans/2026-07-02-invoice-pack-quantity.md

## Current Phase
Phase 4-9: dev-build-and-ship workflow — task 2 complete, task 3 ready

## Completed
- [x] Phase 0 lessons, Phase 1 worktree (feature/invoice-pack-quantity)
- [x] Phase 2 brainstorm + design doc (committed 7ead6d5b)
- [x] Phase 2.5 design review (Supabase + Frontend) folded (committed 74e37a89)
- [x] Phase 3 plan (committed)
- [x] Preflight check (2026-07-02)
- [x] Task 1: Migration add pack_quantity + pgTAP test (committed 6dc7c07c)
- [x] Task 2: pgTAP test — column contract + round-trip for pack_quantity (committed 6dc7c07c — test file 48_receipt_pack_quantity.sql verified: all 5 tests pass)

## Preflight Results (2026-07-02)
- gh: authenticated as jdelgado2002 ✓
- jq: 1.7.1-apple ✓
- node: v20.20.2 ✓
- coderabbit: 0.6.4 ✓
- codex: 0.137.0 ✓ (available)
- .env.local symlink: created ✓
- SONAR_TOKEN: NOT_SET (warning only)
- SONAR_PROJECT_KEY: NOT_SET (warning only)
- Branch: feature/invoice-pack-quantity ✓

## Key Decisions
- quantity = casesOrdered × unitsPerPack (inner units); package_type = inner unit; size_value/size_unit = per-inner size
- DO NOT write products.package_qty (calculate_recipe_cost multiplies size_value × package_qty → would corrupt P&L)
- Store pack on receipt_line_items.pack_quantity (audit/UI only)
- Idempotency + current_stock race: pre-existing, out of scope

## CI Status
- PR: not yet created

## Blockers
- None
