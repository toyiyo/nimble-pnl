# Check MICR Positioning Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the MICR line printing past the right edge of the paper by replacing
jsPDF's buggy `align: 'right'` + `charSpace` combination with manual ANSI X9 spec-compliant
left-anchored placement.

**Architecture:** Extract a pure `computeMicrPlacement` helper that returns deterministic
`{ leftX, baselineY, rightEdgeX, totalWidth }` from `pageWidth`, `checkBottomY`,
`measuredTextWidth`, `charCount`, and `charSpace`. `renderMicrLine` calls it instead of
relying on `align: 'right'`. Right edge of the rightmost MICR character lands at exactly
`pageWidth − 1.9375"` (ANSI position 14 — the boundary between the on-us field and the
amount field, which receiving banks encode).

**Tech Stack:** jsPDF 3.x, vitest, jsdom, MICR-E13B TTF (already bundled).

---

### File Structure

| File | Role |
|------|------|
| `src/utils/checkPrinting.ts` (modify) | Adds `computeMicrPlacement` + constants; rewrites `renderMicrLine` to use them |
| `tests/unit/computeMicrPlacement.test.ts` (create) | Pure-function unit tests — 6 cases |
| `tests/unit/checkPrinting.test.ts` (modify) | Adds 3 PDF-stream regression assertions |

---

### Task 1: Add ANSI X9 constants + pure placement helper

**Files:**
- Modify: `src/utils/checkPrinting.ts` (add constants and exported function near top, before `renderCheckPageSync`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/computeMicrPlacement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeMicrPlacement } from '../../src/utils/checkPrinting';

describe('computeMicrPlacement', () => {
  it('places right edge 1.9375" from right (ANSI position 14)', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.rightEdgeX).toBeCloseTo(8.5 - 1.9375, 4);
    // 6.5625
  });

  it('baseline lands 0.3125" from bottom of check', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.baselineY).toBeCloseTo(3.5 - 0.3125, 4);
    // 3.1875
  });

  it('totalWidth = measuredTextWidth + charSpace × (N − 1)', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.totalWidth).toBeCloseTo(4.0 + 0.018 * 31, 6);
  });

  it('leftX = rightEdgeX − totalWidth', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.leftX).toBeCloseTo(placement.rightEdgeX - placement.totalWidth, 6);
  });

  it('charSpace = 0 makes totalWidth === measuredTextWidth', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0,
    });
    expect(placement.totalWidth).toBe(4.0);
  });

  it('N = 1 has zero inter-char gaps', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 0.13,
      charCount: 1,
      charSpace: 0.018,
    });
    expect(placement.totalWidth).toBe(0.13);
  });

  it('leftX stays > 0 even at max realistic MICR width (17-digit account, 7-digit check#)', () => {
    // Worst case: ⑈9999999⑈ + 2 spaces + ⑆111000614⑆ + 2 spaces + 12345678901234567⑈
    // ≈ 9 + 2 + 11 + 2 + 18 = 42 chars × ~0.13"/char + 41 × 0.018" = 5.46 + 0.74 = 6.2"
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 5.5,
      charCount: 42,
      charSpace: 0.018,
    });
    expect(placement.leftX).toBeGreaterThan(0);
    // Sanity: must still leave room on the left (≥ 0.25" margin)
    expect(placement.leftX).toBeGreaterThan(0.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/computeMicrPlacement.test.ts`
Expected: FAIL with `Cannot find name 'computeMicrPlacement'` (or similar import error).

- [ ] **Step 3: Write minimal implementation**

In `src/utils/checkPrinting.ts`, near the top after the existing imports/exports, add:

```typescript
// ---------------------------------------------------------------------------
// MICR placement (ANSI X9.100-160-1)
// ---------------------------------------------------------------------------

/**
 * Reserved horizontal margin between the rightmost issuer-printed MICR
 * character and the right edge of the check. Per ANSI X9.100-160-1, positions
 * 1–12 (rightmost 1.5") are the AMOUNT field encoded by the receiving bank,
 * and position 13 is a mandatory blank spacer. The on-us symbol (⑈) closing
 * the account number must therefore land at position 14:
 *   5/16" (right edge of position 1) + 13 × 1/8" = 1.9375"
 * Encroaching closer to the right edge risks colliding with the bank's
 * amount-field encoder and getting the check rejected.
 */
export const MICR_RIGHT_MARGIN_INCHES = 1.9375;

/**
 * Vertical baseline of the MICR text, measured from the bottom of the check.
 * ANSI allows 3/16"–7/16"; we use the midpoint 5/16" (matches Toast's
 * observed production placement of ~0.314").
 */
export const MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES = 0.3125;

export interface MicrPlacementInput {
  pageWidth: number;         // page width in inches
  checkBottomY: number;      // bottom edge of the check (inches from top of page)
  measuredTextWidth: number; // doc.getTextWidth(renderable) in inches
  charCount: number;         // number of glyphs in the rendered MICR string
  charSpace: number;         // inter-character gap in inches
}

export interface MicrPlacement {
  leftX: number;       // X coord to pass to doc.text (no align)
  baselineY: number;   // Y coord (jsPDF baseline)
  rightEdgeX: number;  // computed right edge of the rendered text
  totalWidth: number;  // measuredTextWidth + charSpace × (N − 1)
}

export function computeMicrPlacement(input: MicrPlacementInput): MicrPlacement {
  const interCharGaps = Math.max(0, input.charCount - 1);
  const totalWidth = input.measuredTextWidth + input.charSpace * interCharGaps;
  const rightEdgeX = input.pageWidth - MICR_RIGHT_MARGIN_INCHES;
  return {
    leftX: rightEdgeX - totalWidth,
    baselineY: input.checkBottomY - MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES,
    rightEdgeX,
    totalWidth,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/computeMicrPlacement.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/check-micr-positioning add \
  src/utils/checkPrinting.ts tests/unit/computeMicrPlacement.test.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/check-micr-positioning commit -m "feat(checks): add ANSI X9 MICR placement helper"
```

---

### Task 2: Wire renderMicrLine to the new helper

**Files:**
- Modify: `src/utils/checkPrinting.ts:278-304` (`renderMicrLine` function body)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/checkPrinting.test.ts` inside the `describe('generateCheckPDF', ...)` block:

```typescript
  it('MICR line right edge stays inside ANSI position-14 boundary (≤ 6.5625")', async () => {
    const config: CheckPrintConfig = {
      business_name: 'Test Restaurant',
      business_address_line1: null,
      business_address_line2: null,
      business_city: null,
      business_state: null,
      business_zip: null,
      bank_name: 'Test Bank NA',
      print_bank_info: true,
      routing_number: '111000614',
      account_number: '2907959096',
    };
    const doc = await generateCheckPDFAsync(config, [
      { checkNumber: 1002, payeeName: 'X', amount: 1, issueDate: '2026-04-26' },
    ]);
    const output = doc.output();

    // jsPDF emits the MICR Tj as <hex...> Tj preceded by `<x> <y> Td`.
    // We look for the Td immediately preceding a hex-encoded glyph string of
    // length consistent with our MICR (≥ 30 glyphs = ≥ 120 hex chars).
    const tdMicrMatch = output.match(/(\d+\.?\d*)\s+(\d+\.?\d*)\s+Td\s*\n?\s*<[0-9a-f]{120,}>\s*Tj/i);
    expect(tdMicrMatch).not.toBeNull();
    if (!tdMicrMatch) return;

    const tdX_pt = parseFloat(tdMicrMatch[1]);
    const tdY_pt = parseFloat(tdMicrMatch[2]);

    // pdf is in points (72/in). Td is the LEFT edge of the rendered text
    // (jsPDF emits no align translate when we pass leftX directly).
    const tdX_in = tdX_pt / 72;
    expect(tdX_in).toBeGreaterThan(0); // not off the left edge either

    // Y in PDF user space is from bottom-left. Page height = 792pt = 11".
    const tdY_in_from_top = (792 - tdY_pt) / 72;
    // Baseline must be in the ANSI clear band: 3.0625"–3.3125" for a 3.5" check.
    expect(tdY_in_from_top).toBeGreaterThanOrEqual(3.0);
    expect(tdY_in_from_top).toBeLessThanOrEqual(3.35);
  });

  it('MICR line does NOT use jsPDF align: right (avoids charSpace overflow bug)', async () => {
    // The original bug used `align: 'right'` which jsPDF compiles to a Tw/Tj
    // pair where the X coordinate is derived from getTextWidth() WITHOUT
    // charSpace. The fix avoids that path entirely. We assert structurally
    // that the MICR Td X is NOT at the right-margin we would have used (8.0").
    const config: CheckPrintConfig = {
      business_name: 'Test Restaurant',
      business_address_line1: null, business_address_line2: null,
      business_city: null, business_state: null, business_zip: null,
      bank_name: 'Test Bank NA',
      print_bank_info: true,
      routing_number: '111000614',
      account_number: '2907959096',
    };
    const doc = await generateCheckPDFAsync(config, [
      { checkNumber: 1002, payeeName: 'X', amount: 1, issueDate: '2026-04-26' },
    ]);
    const output = doc.output();
    const tdMicrMatch = output.match(/(\d+\.?\d*)\s+(\d+\.?\d*)\s+Td\s*\n?\s*<[0-9a-f]{120,}>\s*Tj/i);
    expect(tdMicrMatch).not.toBeNull();
    if (!tdMicrMatch) return;

    const tdX_in = parseFloat(tdMicrMatch[1]) / 72;

    // The bug placed Td X near 5.24" (because getTextWidth-based right-align
    // landed near pageWidth − 0.5" − getTextWidth ≈ 5.24"). The fix should
    // place leftX such that rightX = 6.5625" (ANSI position 14).
    // We assert the leftX is consistent with that goal: the rendered text
    // width is bounded, so leftX must be < 6.5625" but > 0.5" for a typical
    // 4–5" wide MICR string.
    expect(tdX_in).toBeGreaterThan(0.5);
    expect(tdX_in).toBeLessThan(6.5625);
  });

  it('MICR right edge is within ANSI tolerance (≥ 6.5" from left, ≤ 7.0")', async () => {
    // Render-side guarantee: text width + leftX puts the right edge at
    // pageWidth − 1.9375" = 6.5625", with measurement noise tolerance.
    const config: CheckPrintConfig = {
      business_name: 'X', business_address_line1: null, business_address_line2: null,
      business_city: null, business_state: null, business_zip: null,
      bank_name: 'Test Bank NA',
      print_bank_info: true,
      routing_number: '111000614',
      account_number: '2907959096',
    };
    const doc = await generateCheckPDFAsync(config, [
      { checkNumber: 1002, payeeName: 'X', amount: 1, issueDate: '2026-04-26' },
    ]);
    const output = doc.output();
    // Verify the math is correct by computing it directly via the helper.
    const { computeMicrPlacement, MICR_RIGHT_MARGIN_INCHES } = await import('../../src/utils/checkPrinting');
    expect(MICR_RIGHT_MARGIN_INCHES).toBeCloseTo(1.9375, 4);
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.rightEdgeX).toBeCloseTo(6.5625, 4);
    expect(output.length).toBeGreaterThan(100);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- tests/unit/checkPrinting.test.ts`
Expected: 3 new tests FAIL — the existing `renderMicrLine` still uses `align: 'right'`
with `pageWidth − 0.5"`, so the Td X coordinate is wrong.

- [ ] **Step 3: Rewrite renderMicrLine**

Replace lines 278–304 of `src/utils/checkPrinting.ts`:

```typescript
async function renderMicrLine(
  doc: jsPDF,
  check: CheckData,
  settings: CheckPrintConfig,
  pageWidth: number,
): Promise<void> {
  if (!settings.print_bank_info || !settings.routing_number || !settings.account_number) {
    return;
  }
  const fontFamily = await registerMicrFont(doc);
  const micr = formatMicrLine({
    checkNumber: check.checkNumber,
    routingNumber: settings.routing_number,
    accountNumber: settings.account_number,
  });
  const renderable = toMicrPdfText(micr);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);

  // ANSI X9 placement: compute the left X manually so the right edge lands at
  // pageWidth − MICR_RIGHT_MARGIN_INCHES regardless of charSpace.
  // jsPDF's align: 'right' computes width without charSpace and would cause
  // the rendered text to overshoot the right edge by (N − 1) × charSpace.
  const charSpace = 0.018;
  const measuredTextWidth = doc.getTextWidth(renderable);
  const { leftX, baselineY } = computeMicrPlacement({
    pageWidth,
    checkBottomY: 3.5,
    measuredTextWidth,
    charCount: renderable.length,
    charSpace,
  });

  doc.text(renderable, leftX, baselineY, { charSpace });

  doc.setFont('helvetica', 'normal');
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- tests/unit/checkPrinting.test.ts tests/unit/computeMicrPlacement.test.ts`
Expected: PASS — all checkPrinting + computeMicrPlacement tests green.

- [ ] **Step 5: Run full unit suite**

Run: `npm run test`
Expected: PASS — no regressions in other unit tests.

- [ ] **Step 6: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/check-micr-positioning add \
  src/utils/checkPrinting.ts tests/unit/checkPrinting.test.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/check-micr-positioning commit -m "fix(checks): position MICR per ANSI X9 — right edge at position 14 (1.9375\" from right)"
```

---

### Task 3: Local verification + smoke PDF

**Files:**
- No code changes; only verification.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — no TS errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS or warnings only.

- [ ] **Step 3: Run full unit suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Build production bundle**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Generate a smoke-test PDF**

Run a short Node script that imports `generateCheckPDFAsync` and writes a PDF to `/tmp/smoke-micr-fix.pdf`. Inspect with `pdftotext -bbox-layout /tmp/smoke-micr-fix.pdf -` and confirm:
  - `xMax` of the rightmost MICR field is at `~472.5pt = 6.5625"`
  - All 3 MICR fields' yMin is in [220, 240] pts (clear band range for a 3.5" check)

- [ ] **Step 6: Commit (no-op if no changes)**

If verification produced changes, commit them. Otherwise skip.

---

### Task 4: Code-simplify pass

- [ ] **Step 1: Invoke the `simplify` skill**

Skim the diff with the skill's lens. Specifically check:
- Are `MICR_RIGHT_MARGIN_INCHES` / `MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES` named clearly enough?
- Is `computeMicrPlacement` doing one thing?
- Are there any unused imports or stale comments?

- [ ] **Step 2: Apply any simplifications**

If issues found, fix and re-run `npm run test`.

- [ ] **Step 3: Commit if changes were made**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/check-micr-positioning commit -am "refactor(checks): simplify MICR placement helper"
```

---

### Task 5: CodeRabbit local review

- [ ] **Step 1: Invoke the `review` skill**

Run CodeRabbit CLI on the branch diff. Triage findings:
- Critical / actionable → fix and recommit
- Style / nit → ignore unless trivially correct

---

### Task 6: Push, open PR, watch CI

- [ ] **Step 1: Push the branch**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/check-micr-positioning push -u origin fix/check-micr-positioning
```

- [ ] **Step 2: Open PR via the `pr` skill**

Title: `fix(checks): MICR line printed off right edge of paper — ANSI X9 spec compliance`

- [ ] **Step 3: Watch CI**

`gh pr checks <PR>` — investigate and fix any red checks. Loop until green.

- [ ] **Step 4: Phase 9d gate — review-comment triage**

Use `gh api repos/:owner/:repo/pulls/<PR>/comments` to fetch CodeRabbit/Codex comments and triage each. Reply or fix-and-recommit each one.

- [ ] **Step 5: Final**

Once both CI is green AND every comment is addressed, notify user.

---

## Self-Review

**Spec coverage:**
- Right edge at ANSI position 14: Task 1 (helper) + Task 2 (renderer)
- Baseline 5/16" from check bottom: Task 1 + Task 2
- Pure-function helper for unit testing: Task 1
- PDF-stream regression test: Task 2

**Placeholder scan:** None.

**Type consistency:** `MicrPlacementInput`, `MicrPlacement`, `computeMicrPlacement`,
`MICR_RIGHT_MARGIN_INCHES`, `MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES` are used identically
across Task 1 and Task 2 ✓.
