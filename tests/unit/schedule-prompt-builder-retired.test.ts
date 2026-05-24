import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
