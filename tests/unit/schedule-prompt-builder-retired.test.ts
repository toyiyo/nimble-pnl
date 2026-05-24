import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

describe('LLM-only path retirement', () => {
  it('schedule-prompt-builder.ts no longer exports buildSchedulePrompt or SYSTEM_PROMPT', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/schedule-prompt-builder.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/^export function buildSchedulePrompt/m);
    expect(src).not.toMatch(/^export interface SchedulePromptResult/m);
    expect(src).not.toMatch(/const SYSTEM_PROMPT = /);
    expect(src).not.toMatch(/function buildUserPrompt\(/);
  });

  it('schedule-prompt-builder.ts still exports computeHourBudget', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/schedule-prompt-builder.ts'),
      'utf-8',
    );
    expect(src).toMatch(/^export function computeHourBudget/m);
  });

  it('generate-schedule/index.ts no longer imports buildSchedulePrompt', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/generate-schedule/index.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/buildSchedulePrompt/);
  });
});

describe('buildWeekDates consumer audit', () => {
  it('has no import consumers outside its definition file', () => {
    const root = resolve(__dirname, '../..');

    // grep -F avoids all regex/quoting issues; we confirm with a JS regex after.
    let candidates: string[] = [];
    try {
      candidates = execSync('grep -rlF buildWeekDates supabase/ src/ tests/', { cwd: root })
        .toString().trim().split('\n').filter(Boolean);
    } catch {
      // grep exits non-zero when there are no matches at all — fine.
    }

    const allowed = new Set<string>([
      'supabase/functions/_shared/schedule-prompt-builder.ts',
    ]);

    // Re-read each candidate and check for an actual import statement (not mere JSDoc mention).
    const importRe = /(?:from\s+['"][^'"]*buildWeekDates|import\s*\{[^}]*\bbuildWeekDates\b)/;
    const disallowed = candidates.filter((p) => {
      if (allowed.has(p)) return false;
      if (p.startsWith('tests/')) return false;
      try {
        const src = readFileSync(resolve(root, p), 'utf-8');
        return importRe.test(src);
      } catch {
        return false;
      }
    });
    expect(disallowed).toEqual([]);
  });
});
