/**
 * schedule-preference-llm.ts
 *
 * Optional second-pass swap proposer driven by free-text manager prefs.
 * Only invoked when preferencesText is non-empty. Each proposed swap is
 * server-re-validated; illegal swaps are silently dropped.
 */

import type { GeneratedShift } from './schedule-validator.ts';
import type { ScheduleContext } from './schedule-prompt-builder.ts';

export interface SwapRecord {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

export interface RejectedSwap extends SwapRecord {
  rejection_code: string;
}

export interface PreferenceResult {
  shifts: GeneratedShift[];
  appliedSwaps: SwapRecord[];
  rejectedSwaps: RejectedSwap[];
  modelUsed: string | null;
}

export interface PreferenceModelConfig {
  id: string;
  perCallTimeoutMs: number;
  maxRetries: number;
}

export const PREFERENCE_MODELS: PreferenceModelConfig[] = [
  { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000, maxRetries: 1 },
  { id: 'google/gemini-2.5-flash-lite', perCallTimeoutMs: 25_000, maxRetries: 1 },
];

export async function applyPreferences(
  schedule: GeneratedShift[],
  _ctx: ScheduleContext,
  preferencesText: string,
  _models: PreferenceModelConfig[],
): Promise<PreferenceResult> {
  if (!preferencesText.trim()) {
    return {
      shifts: schedule,
      appliedSwaps: [],
      rejectedSwaps: [],
      modelUsed: null,
    };
  }
  throw new Error(
    'applyPreferences: LLM swap pass not yet wired (Task 13). ' +
      'Pass empty preferencesText to bypass.',
  );
}
