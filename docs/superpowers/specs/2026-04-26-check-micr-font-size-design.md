# Check MICR Font Size Fix — Design

## Problem

After PR #480 fixed MICR horizontal placement, the user observed that our
rendered MICR characters look noticeably smaller than the production
Toast/Gusto check samples we cross-referenced. Investigation shows we are
**below ANSI X9.27 / X9.100-160-1 spec** at the current `setFontSize(12)` —
which is a real bank-rejection risk per the user's stated concern.

## ANSI requirements

ANSI X9.27 / X9.100-160-1 specify the following for MICR-E13B:

| Property            | ANSI requirement       |
|---------------------|------------------------|
| Character height    | 0.117" ± 0.005 (3 mm)  |
| Character pitch     | 0.125" (8 cpi)         |
| Stroke width        | 0.013"                 |
| "0" digit width     | 0.091"                 |
| Vertical placement  | 3/16"–7/16" from check bottom (already correct) |
| Horizontal anchor   | Position 14 = 1.9375" from right edge (PR #480 fix) |

## Empirical TTF measurement

Our bundled font `src/assets/fonts/micr-e13b.ttf` (15580 bytes, freeware)
has unusual TTF metrics that affect how `setFontSize(pt)` translates to
inches:

```
unitsPerEm:            4096   (atypical — standard fonts use 1000 or 2048)
font bbox height:      1919 units
all-character advance: 2048 units (mono-spaced incl. ⑆ / ⑈ / spaces)
```

Rendered size at various `setFontSize(pt)` values:

| pt | Char height | Advance width | Spec-compliant? |
|----|-------------|---------------|-----------------|
| 10 | 0.0651"     | 0.0694"       | ❌              |
| 12 | 0.0781"     | 0.0833"       | ❌ (current)    |
| 14 | 0.0911"     | 0.0972"       | ❌              |
| 16 | 0.1041"     | 0.1111"       | ❌              |
| **18** | **0.1171"** | **0.1250"** | ✅ **exact match** |
| 20 | 0.1301"     | 0.1389"       | ❌ (slightly over) |

**18pt hits the spec exactly** because `(1919 × 18) / (4096 × 72) = 0.1171"`
and `(2048 × 18) / (4096 × 72) = 0.1250"`. This is a coincidence of how this
specific TTF is digitized — for a typical TTF (upm=2048) the magic size would
be 12pt, which is why most MICR-font docs say "use 12pt at 600 dpi".

Standard MICR-E13B TTF docs (from multiple vendors) confirm the fonts are
"designed to meet ANSI and ABA standards when printed at exactly point size 12"
— but only for fonts digitized for that. Our file isn't.

## Approach

Two changes to `renderMicrLine` in `src/utils/checkPrinting.ts`:

1. **Bump font size:** `doc.setFontSize(12)` → `doc.setFontSize(18)`.
2. **Drop manual character spacing:** `MICR_CHAR_SPACE_INCHES = 0.018` → `0`.
   The font's own advance width at 18pt is already 0.125" (= 8 cpi spec),
   so any extra `charSpace` overshoots. PR #480 needed the extra 0.018"
   only because at 12pt the advance was just 0.0833" — 33% under spec —
   and the gap was a band-aid to widen the rendered line. With 18pt the
   font itself produces the right pitch, so `charSpace` becomes 0.

The geometry helper `computeMicrPlacement` and the right-anchor at
position 14 (`MICR_RIGHT_MARGIN_INCHES = 1.9375`) carry over unchanged.

### Effect on line geometry

For a typical 32-char MICR line:

| Setting     | char width | inter-char gap | total line width |
|-------------|-----------:|---------------:|-----------------:|
| 12pt + 0.018 (current) | 0.0833" | 31 × 0.018" = 0.558" | ~3.22" |
| 18pt + 0    (new)      | 0.1250" | 0                    | ~4.00" |

Worst case (max-realistic input — 7-digit check number + 17-digit account):

```
9 + 2 + 11 + 2 + 18 = 42 chars × 0.125" = 5.25"
rightEdgeX = 8.5 − 1.9375 = 6.5625"
leftX       = 6.5625 − 5.25 = 1.3125"
```

Still well clear of the 0.5" left margin. ✓

### What does NOT change

- The MICR field format (still `aux on-us / routing / on-us+account`)
- The right anchor (`pageWidth − 1.9375"`)
- The vertical placement (`checkBottomY − 0.3125"`)
- The `computeMicrPlacement` helper signature
- The font registration flow (`registerMicrFont`, `toMicrPdfText`)

## Files affected

| File | Change |
|------|--------|
| `src/utils/checkPrinting.ts` | `setFontSize(12)` → `setFontSize(18)`; `MICR_CHAR_SPACE_INCHES = 0.018` → `0` |
| `tests/unit/checkPrinting.test.ts` | Update MICR regression bounds (line is now ~24% wider) |
| `tests/unit/computeMicrPlacement.test.ts` | Add a "charSpace=0 with realistic 18pt-width input" assertion |

## Tests

**Unit (`computeMicrPlacement.test.ts`):** existing 8 tests already cover the
geometry math correctly for `charSpace=0` (test #5: "charSpace = 0 makes
totalWidth equal measuredTextWidth"). One additional assertion:

- a realistic 18pt MICR width (32 chars × 0.125" = 4.0") with `charSpace=0`
  produces `totalWidth === 4.0` and `leftX > 0.5"` — i.e., still inside the
  printable area on an 8.5" page.

**Integration (`checkPrinting.test.ts`):** the existing CRITICAL MICR
regression tests at `tests/unit/checkPrinting.test.ts:503` and `:550`
assert the rendered `Td` / `Tc` operators. Two updates:

1. Allow `Tc 0` (i.e., no `Tc` op, or `Tc 0`) in the rendered PDF stream
   instead of `Tc 1.296` (= 0.018 in jsPDF user units when scaled).
2. Loosen / shift the leftX bound to reflect the wider 18pt line — the
   line should still land in `(0.5", 4.5")` but the new lower-bound floor
   moves down because the line is wider.

## Risk / rollout

- **Visual change:** MICR characters are ~50% taller and ~50% wider than
  before. This is the correction itself — they should now visually match
  Toast/Gusto sample checks.
- **Bank acceptance:** moves from out-of-spec (rejection risk) to in-spec.
  Net positive.
- **No DB or schema changes.** Single-file code change + test updates.
- **Reverts cleanly** if any production print regresses — this PR can be
  reverted independently of #479 / #480 since `computeMicrPlacement`
  remains backward-compatible.

## Out of scope

- Replacing the bundled TTF with a "12pt = spec" alternative (e.g., GnuMICR).
  This would be a more invasive change requiring license review; the
  font-size adjustment achieves the same outcome with a 2-line diff.
- Per-glyph placement at 8 cpi precision. The TTF's own advance is already
  spec-pitch at 18pt; nothing to add.
- Changing the right-anchor position or vertical placement — both validated
  in PR #480.

## Sources

- ANSI X9.100-160-1-2021 (character height 0.117" ± 0.005, pitch 0.125")
- [ANSI Webstore — X9.100-160-1](https://webstore.ansi.org/standards/ascx9/ansix91001602021)
- MICR vendor documentation (multiple): "designed to meet ANSI/ABA when
  printed at exactly point size 12" — assumes a TTF digitized for that
- TTF metric inspection: this codebase's `src/assets/fonts/micr-e13b.ttf`
  has `unitsPerEm = 4096` (atypical), making 18pt the spec-matching size
- Cross-reference: PR #479, PR #480 (right anchor + clear-band placement)
