# Progress: Invoice importer — read "pack" (inner count) instead of "size" as quantity

## Spec
Link: (pending Phase 2)

## Current Phase
Phase 2: Brainstorm — in-progress (awaiting codebase exploration)

## Completed Tasks
- [x] Phase 0: Consulted lessons.md
- [x] Phase 1: Created worktree + branch feature/invoice-pack-quantity

## Key Domain Facts
- PFG invoice columns: Item# | Ordered | Shipped | Pack | Size | Unit | Description | Price | Extension
  - Item 87750: Ordered=1, Pack=500, Size=.32 OZ -> 1 case = 500 packets of .32 oz each
- Sygma invoice: Pack/Size combined token e.g. "1/20 LB", "8/32 OZ", "2/2.5GAL" (pack=first, size=second)
- Purchasing unit = case/box; Pack = inner count per case; Size = size of each inner unit
- We buy by the box, sell by the packet -> quantity should be driven by Pack, not Size

## CI Status
- PR: not yet created

## Blockers
- None

## Key Decisions
- (pending)
