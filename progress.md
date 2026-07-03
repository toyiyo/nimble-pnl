# Progress: Invoice importer — read "pack" (inner count) instead of "size" as quantity

## Spec
- Design: docs/superpowers/specs/2026-07-02-invoice-pack-quantity-design.md
- Plan:   docs/superpowers/plans/2026-07-02-invoice-pack-quantity.md

## Current Phase
Phase 6 complete — simplification committed (b7748bc5)

## Completed
- [x] Phase 0 lessons, Phase 1 worktree (feature/invoice-pack-quantity)
- [x] Phase 2 brainstorm + design doc (committed 7ead6d5b)
- [x] Phase 2.5 design review (Supabase + Frontend) folded (committed 74e37a89)
- [x] Phase 3 plan (committed)
- [x] Preflight check (2026-07-02)
- [x] Task 1: Migration add pack_quantity + pgTAP test (committed 6dc7c07c)
- [x] Task 2: pgTAP test — column contract + round-trip for pack_quantity (committed 6dc7c07c — test file 48_receipt_pack_quantity.sql verified: all 5 tests pass)
- [x] Task 3: Pure helpers parsePackSizeToken + computeImportedQuantity (committed 0d113d9e — 8 vitest tests all green)
- [x] Task 4: AI extraction — ParsedLineItem fields, prompt examples, DB insert mapping (committed ef9e7a7b — 12 vitest tests all green, typecheck clean)
- [x] Task 5: Frontend interface + generated types — pack_quantity on ReceiptLineItem, src/integrations/supabase/types.ts, src/types/supabase.ts (committed b7e46fe8 — 8 vitest tests all green, typecheck clean, package_qty NOT written confirmed)
- [x] Task 6: Receipt review UI: pack summary line + inner-unit package-definition copy (committed de7174d8 — 15 vitest tests all green, typecheck clean, no raw green-* classes in edited block)
- [x] Task 7: Full verification — typecheck PASS, 35 feature tests pass (5102 total), pgTAP 48_receipt_pack_quantity all 5 pass, build PASS (committed — see below)

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

## Verification Results (task 7, Phase 4 complete)
- typecheck: PASS
- lint: PASS (pre-existing `any` errors unrelated to this feature; none introduced)
- vitest: 5102 tests pass; 4 fail (fast-xml-parser missing — Focus POS feature, pre-existing, unrelated)
- Feature vitest: 35/35 pass (receiptImportUtils, receiptLineItemPackQuantity, ReceiptItemRow.packSummary)
- pgTAP 48_receipt_pack_quantity: 5/5 pass
- build: PASS (production build succeeds)

## Phase 5 — UI Review Results (2026-07-02)
- Violations found: 12 raw color classes (green-50/700, blue-50/700, amber-50/700/400/500), 8 Label elements using text-xs instead of required scale
- Fixed: all raw colors migrated to semantic tokens (bg-muted, text-foreground, text-muted-foreground, border-border/40); all Labels updated to text-[12px] font-medium uppercase tracking-wider
- No accessibility issues found; pack summary aria-live="polite" correct
- typecheck: PASS, vitest: PASS after fixes
- Committed: 0e9bf898

## CI Status
- PR: not yet created

## Blockers
- None
