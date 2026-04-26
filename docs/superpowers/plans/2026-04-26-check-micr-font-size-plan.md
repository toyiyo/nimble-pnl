# MICR Font Size Compliance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump MICR rendering to 18pt and remove inter-char spacing so the
on-paper output meets ANSI X9.27 / X9.100-160-1 (0.117" character height,
0.125" pitch / 8 cpi).

**Architecture:** Two-line code change in `renderMicrLine`
(`src/utils/checkPrinting.ts`): `setFontSize(12)` → `setFontSize(18)` and
`MICR_CHAR_SPACE_INCHES = 0.018` → `0`. New CRITICAL test that locks the
font-size and char-space values into the rendered PDF stream so a future
regression can't silently bring back the under-spec rendering. Existing
geometry helper (`computeMicrPlacement`) and right-anchor constant
(`MICR_RIGHT_MARGIN_INCHES = 1.9375`) carry over unchanged.

**Tech Stack:** TypeScript, Vite, jsPDF, vitest.

---

### Task 1: Write the failing CRITICAL test (RED)

**Files:**
- Modify: `tests/unit/checkPrinting.test.ts` (add a new test in the existing
  describe block at the bottom of the file, around line 568, before the
  closing `});`)

**Why this test:** existing CRITICAL tests at line 503 and 550 cover
horizontal placement but not font size or charSpace. A regression that
silently reverts to `setFontSize(12)` would still pass them. This test
asserts the rendered PDF stream's `Tf` (font size) and `Tc` (character
spacing) operators directly, so font-size or charSpace changes can't slip
through unnoticed.

- [ ] **Step 1: Add the failing test**

Insert this block after the existing `'CRITICAL: MICR right edge lands at pageWidth − 1.9375"'`
test, before the final `});` of the `describe('generateCheckPDFAsync',...)` block:

```typescript
  // -------------------------------------------------------------------------
  // ANSI X9.27 / X9.100-160-1 require MICR-E13B characters at 0.117" tall and
  // 0.125" pitch (8 cpi). Our bundled TTF (unitsPerEm=4096) hits that exactly
  // at setFontSize(18) and produces 0.125" advance per glyph natively, so any
  // additional charSpace (Tc) overshoots the spec pitch. Assert both values
  // land in the rendered PDF stream so a regression to 12pt or to a non-zero
  // Tc can't slip through silently.
  // -------------------------------------------------------------------------
  it('CRITICAL: MICR is rendered at setFontSize(18) with no extra charSpace (ANSI X9.27 spec)', async () => {
    const config: CheckPrintConfig = {
      business_name: 'X',
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

    // The MICR Tj contains the routing digits. Walk back from there to find
    // the most recent `Tf` (font set + size) and any `Tc` (char-space) ops.
    const tjIdx = output.indexOf('111000614');
    expect(tjIdx).toBeGreaterThan(-1);

    // 600 chars of context: enough to capture the BT block's font + Tc setup.
    const before = output.slice(Math.max(0, tjIdx - 600), tjIdx);

    // Tf op format: `/<FontName> <size> Tf`
    const tfMatches = [...before.matchAll(/\/[A-Za-z0-9_+,]+\s+(-?\d+\.?\d*)\s+Tf/g)];
    expect(tfMatches.length).toBeGreaterThan(0);
    const lastTfSize = parseFloat(tfMatches[tfMatches.length - 1][1]);
    // jsPDF emits the size in points exactly as passed to setFontSize.
    expect(lastTfSize).toBe(18);

    // Tc op format: `<value> Tc`. With charSpace=0 (or omitted in the call),
    // jsPDF should not emit a non-zero Tc op for this Tj. If Tc is present
    // at all, it must be 0.
    const tcMatches = [...before.matchAll(/(-?\d+\.?\d*)\s+Tc(?![A-Za-z])/g)];
    if (tcMatches.length > 0) {
      const lastTc = parseFloat(tcMatches[tcMatches.length - 1][1]);
      expect(lastTc).toBe(0);
    }
  });
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `npm run test -- tests/unit/checkPrinting.test.ts -t "MICR is rendered at setFontSize(18)"`

Expected: FAIL with `expected 12 to be 18` (because `setFontSize(12)` is still
the source value) and/or a non-zero Tc value.

---

### Task 2: Implement the fix (GREEN)

**Files:**
- Modify: `src/utils/checkPrinting.ts:50` (constant)
- Modify: `src/utils/checkPrinting.ts:334` (font size)

**Why two changes together:** they're conceptually one fix. Bumping font
size without zeroing charSpace would over-shoot the 8 cpi pitch; zeroing
charSpace without bumping font size would under-shoot character height.

- [ ] **Step 1: Bump the font size constant + use it**

There's no constant today — `12` is a magic literal at line 334. Add a named
constant at the top of the MICR-placement section so the test value matches
a single source of truth.

Edit `src/utils/checkPrinting.ts`. Replace:

```typescript
// MICR-E13B inter-character spacing (inches). Tuned to render close to the
// ANSI 8 cpi pitch with the bundled TTF.
const MICR_CHAR_SPACE_INCHES = 0.018;
```

with:

```typescript
// ANSI X9.27 spec: MICR-E13B at 0.117" character height + 0.125" pitch
// (8 cpi). Our bundled TTF (unitsPerEm=4096) reaches both at exactly 18pt;
// see docs/superpowers/specs/2026-04-26-check-micr-font-size-design.md.
const MICR_FONT_POINT_SIZE = 18;

// Zero — the font's own advance width at MICR_FONT_POINT_SIZE is already
// the 0.125" 8 cpi pitch, so any extra Tc overshoots the spec.
const MICR_CHAR_SPACE_INCHES = 0;
```

- [ ] **Step 2: Use the new constant in renderMicrLine**

In the same file, replace:

```typescript
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
```

with:

```typescript
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(MICR_FONT_POINT_SIZE);
  doc.setTextColor(0, 0, 0);
```

- [ ] **Step 3: Run the new CRITICAL test and confirm it passes**

Run: `npm run test -- tests/unit/checkPrinting.test.ts -t "MICR is rendered at setFontSize(18)"`

Expected: PASS.

---

### Task 3: Update existing PR #479 regression test bounds

**Files:**
- Modify: `tests/unit/checkPrinting.test.ts:541-542`

**Why:** The existing CRITICAL regression test at line 503 asserts
`tdX_in > 0.5 && tdX_in < 4.5`. With the wider 18pt line:

```
renderable: ⑈1002⑈  ⑆111000614⑆  2907959096⑈  → 32 chars
totalWidth:  32 × 0.125" = 4.000"
leftX:       (8.5 − 1.9375) − 4.000 = 2.5625"
```

2.5625" still falls inside (0.5, 4.5), so the test continues to pass — but
the comment block above it references the old 12pt arithmetic (`leftX ≈ 2.92"`).
Update the comment so it documents the new geometry; do NOT loosen the
bounds (they still bracket the correct value).

- [ ] **Step 1: Update the explanatory comment**

In `tests/unit/checkPrinting.test.ts`, find the block at lines 537–540:

```typescript
    // Old buggy code: rightX = 8.0; jsPDF align: 'right' subtracted
    // getTextWidth(text) only, so Td X landed near 8.0 − 3.1 = 4.9".
    // Our fix places leftX at (8.5 − 1.9375) − totalWidth ≈ 2.92" for
    // a 3.1" text + 0.018" × 30 = 0.54" charSpace overhead.
```

Replace with:

```typescript
    // Old buggy code (PR #479): rightX = 8.0; jsPDF align: 'right' subtracted
    // getTextWidth(text) only, so Td X landed near 8.0 − 3.1 = 4.9".
    // After PR #480: leftX = (8.5 − 1.9375) − totalWidth.
    // After font-size fix (this PR): 32 chars × 0.125" pitch = 4.0" total →
    // leftX ≈ 2.5625". Still inside the (0.5, 4.5) window below.
```

- [ ] **Step 2: Run the existing CRITICAL regression test**

Run: `npm run test -- tests/unit/checkPrinting.test.ts -t "MICR line Td X is consistent"`

Expected: PASS (no behavior change — just comment update).

---

### Task 4: Add a computeMicrPlacement test for the 18pt + charSpace=0 case

**Files:**
- Modify: `tests/unit/computeMicrPlacement.test.ts`

**Why:** The 8 existing tests cover the geometry math comprehensively, but
none uses the exact (charSpace=0, 18pt-realistic-width) combination that
production now uses. Add one test that locks in the expected `leftX` for
the production-realistic case. This is a defensive test: if anyone later
changes `MICR_RIGHT_MARGIN_INCHES` or the function math, this test pins
down what the rendered geometry should look like for the typical input.

- [ ] **Step 1: Add the new test**

Append before the closing `});` of the describe block in
`tests/unit/computeMicrPlacement.test.ts`:

```typescript
  it('CRITICAL: production geometry — 32-char line at 18pt charSpace=0 leaves leftX ≈ 2.5625"', () => {
    // 32 chars × 0.125" (8 cpi at 18pt with the bundled TTF) = 4.0"
    // rightEdgeX = 8.5 − 1.9375 = 6.5625"
    // leftX     = 6.5625 − 4.0 = 2.5625"
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0,
    });
    expect(placement.totalWidth).toBe(4.0);
    expect(placement.leftX).toBeCloseTo(2.5625, 4);
    // Also confirm the line still has > 2" of clear space on the left
    // (matches Toast's observed behavior).
    expect(placement.leftX).toBeGreaterThan(2.0);
  });
```

- [ ] **Step 2: Run all computeMicrPlacement tests**

Run: `npm run test -- tests/unit/computeMicrPlacement.test.ts`

Expected: 9/9 tests pass.

---

### Task 5: Run full unit test suite + commit

- [ ] **Step 1: Run all unit tests**

Run: `npm run test`

Expected: all green, no skipped, no warnings about unused exports.

- [ ] **Step 2: Run typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/checkPrinting.ts tests/unit/checkPrinting.test.ts tests/unit/computeMicrPlacement.test.ts
git commit -m "fix(checks): MICR at 18pt + charSpace=0 to meet ANSI X9.27"
```

---

## Self-review

**Spec coverage:** every change in the design doc is implemented by a task.
- setFontSize(12)→setFontSize(18) — Task 2, Step 2
- MICR_CHAR_SPACE_INCHES=0.018→0 — Task 2, Step 1
- Update existing test bounds — Task 3
- New CRITICAL test for 18pt + charSpace=0 — Task 1 (PDF stream) + Task 4 (helper math)
- Verify all tests + typecheck + lint + build — Task 5

**Placeholder scan:** no TBD/TODO/"appropriate"/"similar to". Every code
block is the literal text to write.

**Type/identifier consistency:** `MICR_FONT_POINT_SIZE` is introduced in
Task 2 Step 1 and used in Task 2 Step 2 — both with the exact same name.
`MICR_CHAR_SPACE_INCHES` keeps its existing name (value changes, identifier
doesn't). The new test in Task 1 asserts the literal `18` as the rendered
font size — this matches the constant value, but intentionally doesn't
import the constant so the test catches both "constant changed" and
"setFontSize call uses a different value than the constant" regressions.
