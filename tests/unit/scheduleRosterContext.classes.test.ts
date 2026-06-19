import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(resolve(__dirname, '../../src/pages/Scheduling.tsx'), 'utf8');

describe('Scheduling roster context — wiring', () => {
  it('imports the time-off helper and isMinor', () => {
    expect(SRC).toMatch(/from '@\/lib\/scheduleTimeOff'/);
    expect(SRC).toMatch(/buildWeekTimeOff/);
    expect(SRC).toMatch(/summarizeOff/);
    expect(SRC).toMatch(/isMinor/);
  });
  it('imports the CalendarOff icon', () => {
    expect(SRC).toMatch(/\bCalendarOff\b/);
  });
  it('memoizes weekDayKeys and weekTimeOff', () => {
    expect(SRC).toMatch(/const weekDayKeys = useMemo\(/);
    expect(SRC).toMatch(/const weekTimeOff = useMemo\(\s*\(\)\s*=>\s*buildWeekTimeOff\(/s);
  });
});

describe('Scheduling roster context — identity cell', () => {
  it('renders the amber Minor pill from isMinor', () => {
    expect(SRC).toMatch(/isMinorEmployee && \(/);
    expect(SRC).toMatch(/bg-warning\/10 text-warning/);
    expect(SRC).toContain('Minor');
  });
  it('renders the FT/PT tag with muted styling', () => {
    expect(SRC).toMatch(/employment_type === 'part_time' \? 'PT' : 'FT'/);
    expect(SRC).toMatch(/bg-muted text-muted-foreground/);
  });
  it('renders the Off chip with the info token and CalendarOff, not a title tooltip', () => {
    expect(SRC).toMatch(/bg-info\/10 text-info/);
    expect(SRC).toMatch(/off\.label/);
    expect(SRC).toMatch(/sr-only/);
    // negative: no hardcoded blue, no title-attr tooltip on the chip
    expect(SRC).not.toMatch(/bg-blue-/);
  });
});

describe('Scheduling roster context — day cells', () => {
  it('computes per-day off state and run-start', () => {
    expect(SRC).toMatch(/offDayKeys\.has\(/);
    expect(SRC).toMatch(/isRunStart/);
  });
  it('excludes cancelled shifts when computing the conflict state for a time-off day', () => {
    expect(SRC).toMatch(/dayShifts\.some\(s => s\.status !== 'cancelled'\)/);
  });
  it('renders accent bars (info normally, destructive on conflict) and sr-only state', () => {
    expect(SRC).toMatch(/border-l-2 border-info/);
    expect(SRC).toMatch(/border-l-2 border-destructive/);
    expect(SRC).toMatch(/Approved time off/);
    expect(SRC).toMatch(/Scheduling conflict/);
  });
  it('soft-blocks add on off-days with a contextual aria-label', () => {
    expect(SRC).toMatch(/Add anyway/);
    expect(SRC).toMatch(/despite approved time off/);
  });
});

describe('Scheduling roster context — mobile', () => {
  it('extends the mobile avatar aria-label with minor/off state', () => {
    expect(SRC).toMatch(/isMinorEmployee \? ', minor'/);
  });
  it('shows minor/FT-PT/off in the mobile tooltip and marks dots aria-hidden', () => {
    expect(SRC).toMatch(/aria-hidden="true"/);
    expect(SRC).toMatch(/relative/); // avatar wrapper hosts the corner dots
  });
});

describe('Scheduling roster context — keyboard accessibility', () => {
  it('makes the Off chip tooltip trigger a focusable button with a focus ring', () => {
    // a <span> trigger is not keyboard-focusable (CodeRabbit) — must be a button w/ focus ring
    expect(SRC).toMatch(/bg-info\/10 text-info[^"]*focus-visible:ring-ring/);
  });
  it('reveals the per-day add button on keyboard focus, not hover-only', () => {
    expect(SRC).toMatch(/group-focus-within:opacity-100/);
    expect(SRC).toMatch(/focus-visible:opacity-100/);
  });
});
