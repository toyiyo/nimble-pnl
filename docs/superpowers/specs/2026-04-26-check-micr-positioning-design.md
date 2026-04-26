# Check MICR Positioning Fix — Design

## Problem

Production check printed via PR #479 had its MICR line (`⑈checkNo⑈ ⑆routing⑆ account⑈`)
extend off the right edge of the paper. The user reports: "the bank account info is all
the way to the right and hence prints outside of the paper area."

Reproduced from `check-wetzel-s---cold-stone---alamo-ranch-1002-2026-04-26-110922.pdf`:
- jsPDF text op: `Td 377.41 554.4` with `Tc 1.296` (charSpace = 0.018")
- Right-align target was `pageWidth − 0.5"` = x=8.0"
- jsPDF's `align: 'right'` shifts text by `getTextWidth(text)` which **excludes**
  `charSpace`. With ~32 chars and 0.018" charSpace, the rendered right edge
  overshoots `rightX` by `(N−1) × 0.018 ≈ 0.56"`, landing past the 8.5" paper.

This is a known jsPDF bug ([#3735](https://github.com/parallax/jsPDF/issues/3735),
[#3299](https://github.com/parallax/jsPDF/issues/3299)).

## Goals

1. **No checks rejected.** Spec-compliant placement — ANSI X9.100-160-1 specifies
   not just the right margin but also which positions issuer-printed characters
   may occupy.
2. **Match Toast/Gusto behavior.** Left-anchored, well clear of the right edge.
3. **Pure-function helper.** Make the geometry independently unit-testable.

## ANSI X9.100-160-1 facts that drive the fix

MICR characters live in 65 numbered positions, **right-to-left**, each 1/8" wide.
Position 1's right edge is 5/16" from the right edge of the check.

Reserved zones (issuer must leave blank):

| Positions | Field        | Issuer prints? |
|----------|--------------|----------------|
| 1–12     | AMOUNT       | No — encoded by receiving bank |
| 13       | (spacer)     | No |
| 14–32    | ON-US        | Yes — account number, terminated by ⑈ at position 14 |
| 33       | (spacer)     | No |
| 34–43    | ROUTING      | Yes — ⑆ + 9 digits + ⑆ |
| 44       | EPC          | Optional |
| 45+      | AUX ON-US    | Yes — `⑈checkNumber⑈` (only on checks > 6") |

**Implication:** the rightmost issuer-printed character (the on-us ⑈ closing the
account) must land at position 14, whose right edge is at:

```
5/16" + 13 × 1/8" = 1.9375" from the right edge of the check
```

If we right-edge any closer to the page edge, the bank's amount-field encoder
risks colliding with our account-closing ⑈ and rejecting the check.

Vertical placement: baseline 3/16"–7/16" from bottom of check. ANSI midpoint = 5/16".

## Toast / Gusto observed behavior (cross-reference)

Extracted from production Toast paystub
(`Carma_LaurusLLC_RussosattheRimWEEKLY_20260421.pdf`):

- Account+on-us right edge at xMax = 4.819" from left → **3.68" from right edge**
  (more conservative than ANSI minimum of 1.9375")
- MICR baseline ~0.314" from bottom of check (≈ 5/16", center of ANSI range)
- Left-anchored placement; no right-alignment math

Gusto docs ([print payroll checks](https://gusto.com/resources/articles/payroll/print-payroll-checks)):
"routing and account numbers in the **bottom left side** of the check."

Both vendors left-anchor and stay well clear of the right edge.

## Approach

**Manual position calculation, ANSI position-14 right edge.** Compute
`leftX = (pageWidth − 1.9375") − totalRenderedWidth` and place text without
`align`. The right edge becomes deterministic regardless of jsPDF's
charSpace-vs-alignment quirk.

### Geometry helper

```ts
// ANSI X9.100-160-1: positions 1–13 (1.9375" from right) are reserved for the
// AMOUNT field + spacer. The rightmost issuer character must land at position 14.
const MICR_RIGHT_MARGIN_INCHES = 1.9375;

// Baseline 3/16"–7/16" from check bottom. Use spec midpoint (5/16"); matches
// Toast's observed 0.314" placement.
const MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES = 0.3125;

interface MicrPlacementInput {
  pageWidth: number;        // inches
  checkBottomY: number;     // inches from top of page
  measuredTextWidth: number; // doc.getTextWidth(renderable)
  charCount: number;
  charSpace: number;        // inches
}

interface MicrPlacement {
  leftX: number;
  baselineY: number;
  rightEdgeX: number;
  totalWidth: number;
}

export function computeMicrPlacement(input: MicrPlacementInput): MicrPlacement {
  const totalWidth =
    input.measuredTextWidth + input.charSpace * Math.max(0, input.charCount - 1);
  const rightEdgeX = input.pageWidth - MICR_RIGHT_MARGIN_INCHES;
  return {
    leftX: rightEdgeX - totalWidth,
    baselineY: input.checkBottomY - MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES,
    rightEdgeX,
    totalWidth,
  };
}
```

### Render flow

```ts
async function renderMicrLine(doc, check, settings, pageWidth) {
  if (!settings.print_bank_info || !settings.routing_number || !settings.account_number) return;
  const fontFamily = await registerMicrFont(doc);
  const renderable = toMicrPdfText(formatMicrLine({...}));

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);

  const charSpace = 0.018;
  const measuredTextWidth = doc.getTextWidth(renderable);
  const { leftX, baselineY } = computeMicrPlacement({
    pageWidth,
    checkBottomY: 3.5,
    measuredTextWidth,
    charCount: renderable.length,
    charSpace,
  });

  doc.text(renderable, leftX, baselineY, { charSpace }); // no align: manual leftX

  doc.setFont('helvetica', 'normal');
}
```

## Files affected

| File | Change |
|------|--------|
| `src/utils/checkPrinting.ts` | Add constants + `computeMicrPlacement`; rewrite `renderMicrLine` |
| `tests/unit/checkPrinting.test.ts` | Add MICR position regression assertions |
| `tests/unit/computeMicrPlacement.test.ts` *(new)* | Pure-function unit tests |

## Tests

**Unit (`computeMicrPlacement.test.ts`):**
- right edge at `pageWidth − 1.9375"` for any valid input
- baseline at `checkBottomY − 0.3125"`
- `totalWidth` accounts for `charSpace × (N−1)`
- `leftX > 0` for max-realistic input (17-digit account + 7-digit check number)
- zero charSpace produces `totalWidth === measuredTextWidth`
- N=1 produces `totalWidth === measuredTextWidth` (no inter-char gaps)

**Integration (`checkPrinting.test.ts`):**
- after `generateCheckPDFAsync`, parse PDF stream and extract the MICR `Td`/`Tc`
- assert the `Td` X (leftX) falls in `(0.5", 4.5")` — rules out both the
  original right-edge overshoot bug and any future left-margin collision
- assert the rendered right edge is exactly `pageWidth − 1.9375"` by calling
  `computeMicrPlacement` directly with the same inputs
- assert the `Td` Y is in clear-band range (3.0625"–3.3125" for 3.5" check)

## Out of scope

- Changing the MICR field format (still aux-on-us / routing / on-us+account).
- Switching to per-glyph placement for spec-perfect 8 cpi pitch.
- Detecting font-width drift on font upgrades — the position helper accepts
  measured width from jsPDF, so any drift is automatically reflected.

## Risk / rollout

- **Visual change:** the MICR moves left from "off the right edge" to "ending
  ~1.94" from the right edge." Matches Toast/Gusto and keeps the amount field clear.
- **Single-PR fix.** No DB migration, no config flag.
- **Backward compatibility:** does not affect the sync `generateCheckPDF` path
  (unchanged) — only the async path that renders MICR.

## Sources

- [ANSI X9.100-160-1-2021 — ANSI Webstore](https://webstore.ansi.org/standards/ascx9/ansix91001602021)
- [MICR field-position summary — Morovia](https://www.morovia.com/manuals/micr4/ch03.php)
- [MICR specifications overview — ANSI Blog](https://blog.ansi.org/ansi/micr-specifications-checks-ansi-x9-standards/)
- [Gusto print payroll checks](https://gusto.com/resources/articles/payroll/print-payroll-checks)
- [jsPDF #3735 — charSpace affects centering](https://github.com/parallax/jsPDF/issues/3735)
- [jsPDF #3299 — charSpace and maxWidth not respected](https://github.com/parallax/jsPDF/issues/3299)
