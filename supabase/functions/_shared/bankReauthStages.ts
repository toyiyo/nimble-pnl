// Pure escalation-stage math for the bank re-authentication notice ladder.
// No Supabase client, no fetch — directly unit-testable under vitest
// (mirrors the pattern already used by `_shared/resolveChannels.ts` and
// `_shared/availabilityReminderHandler.ts`).
//
// See docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.6.

/** Escalation stages driven by whole UTC days elapsed since deactivation. */
export type ElapsedStage = 'day_1' | 'day_4' | 'day_10';

/** All stages that can appear in `bank_reauth_notices.stage`, including the
 * one-off recovery notice which isn't reached via `stageForElapsedDays`. */
export type NoticeStage = ElapsedStage | 'recovered';

export interface StageRecipients {
  roles: Array<'owner' | 'manager'>;
  channels: Array<'email' | 'push'>;
}

// Ordered highest-first so the first threshold met wins.
const ELAPSED_STAGE_THRESHOLDS: ReadonlyArray<{ stage: ElapsedStage; minDays: number }> = [
  { stage: 'day_10', minDays: 10 },
  { stage: 'day_4', minDays: 4 },
  { stage: 'day_1', minDays: 1 },
];

/**
 * Maps whole UTC days elapsed since deactivation to the escalation stage
 * currently in effect. Boundaries are inclusive at exactly 1/4/10 days, and
 * the stage caps at `day_10` — there is no stage past 10. 0 days elapsed
 * (day 0) returns null: that window is in-app only, no notice is sent.
 */
export function stageForElapsedDays(elapsedDays: number): ElapsedStage | null {
  for (const { stage, minDays } of ELAPSED_STAGE_THRESHOLDS) {
    if (elapsedDays >= minDays) return stage;
  }
  return null;
}

/**
 * The stage that should be notified right now, given which stages have
 * already been sent for this outage (`sentStages`, keyed by
 * `(connected_bank_id, stage, deactivated_at)` in `bank_reauth_notices`).
 *
 * Only the *currently applicable* stage (per `stageForElapsedDays`) is ever
 * a candidate — an already-sent current stage returns null rather than
 * backfilling an earlier, skipped stage. E.g. a bank first checked at day 15
 * jumps straight to `day_10`; `day_4` is never sent for it.
 */
export function nextStage(sentStages: ElapsedStage[], elapsedDays: number): ElapsedStage | null {
  const stage = stageForElapsedDays(elapsedDays);
  if (!stage) return null;
  return sentStages.includes(stage) ? null : stage;
}

// Escalation ladder from the experience design (§4.6): day_1/day_4 reach
// owners + managers over email + push; day_10 narrows to owners, email only
// (a consequence tone, not an interrupt); recovered reaches owners +
// managers as an email-only receipt.
const STAGE_RECIPIENTS: Record<NoticeStage, StageRecipients> = {
  day_1: { roles: ['owner', 'manager'], channels: ['email', 'push'] },
  day_4: { roles: ['owner', 'manager'], channels: ['email', 'push'] },
  day_10: { roles: ['owner'], channels: ['email'] },
  recovered: { roles: ['owner', 'manager'], channels: ['email'] },
};

/** Recipient roles and channels for a given notice stage. */
export function recipientsForStage(stage: NoticeStage): StageRecipients {
  return STAGE_RECIPIENTS[stage];
}
