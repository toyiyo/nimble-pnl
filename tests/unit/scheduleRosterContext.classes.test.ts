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
    expect(SRC).toMatch(/bg-amber-500\/10 text-amber-600/);
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
