import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Task 7 (design §"ShiftCard keyboard access"): ShiftCard's clickable surface
// is a bare `<div onClick>` with no keyboard support. This is a source-text
// pin test (mirrors tests/unit/scheduleRosterContext.classes.test.ts) since
// ShiftCard is a module-private component inside Scheduling.tsx, not exported
// for direct render-testing.
const SRC = readFileSync(resolve(__dirname, '../../src/pages/Scheduling.tsx'), 'utf8');

// Isolate the ShiftCard component body so assertions can't accidentally match
// unrelated keyboard/focus code elsewhere in this large file.
function extractShiftCardBody(src: string): string {
  const start = src.indexOf('const ShiftCard = (');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n};', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('ShiftCard — keyboard accessibility', () => {
  const body = extractShiftCardBody(SRC);

  it('makes the clickable surface a role="button"', () => {
    expect(body).toMatch(/role="button"/);
  });

  it('makes the clickable surface focusable via tabIndex={0}', () => {
    expect(body).toMatch(/tabIndex=\{0\}/);
  });

  it('activates on Enter or Space via onKeyDown', () => {
    expect(body).toMatch(/onKeyDown=\{/);
    expect(body).toMatch(/key === 'Enter'/);
    expect(body).toMatch(/key === ' '/);
  });

  it('shows a focus-visible ring on the clickable surface', () => {
    expect(body).toMatch(/focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/);
  });
});
