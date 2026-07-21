/**
 * Pure copy/severity builders for the impact-aware deletion dialogs
 * (shift templates + employee availability). No React, no supabase —
 * these take already-fetched data and return display-ready strings/flags
 * so the dialogs stay dumb and the branching logic is unit-testable in
 * isolation.
 *
 * See docs/superpowers/specs/2026-07-20-impact-aware-deletion-design.md
 * for the UX this copy renders into.
 */

export type Severity = 'low' | 'high';

export interface TemplateDeletionImpact {
  pendingClaims: { count: number; names: string[] };
  scheduledShiftsKept: number;
  upcomingOpenSpots: number;
}

export type LedgerTone = 'destructive' | 'warning' | 'success';

export interface LedgerChip {
  key: string;
  label: string;
  tone: LedgerTone;
}

export interface LedgerLine {
  key: string;
  text: string;
}

export interface TemplateLedger {
  chips: LedgerChip[];
  removed: LedgerLine[];
  kept: LedgerLine[];
  needsAck: boolean;
  ackLabel: string | null;
}

/**
 * Severity is driven entirely by pending claims: they are the one
 * irreversible consequence of a template hard-delete (open_shift_claims
 * cascades). Scheduled shifts survive (FK is SET NULL) and open spots are
 * just no-longer-claimable, so neither raises the pill to "high".
 */
export function deriveTemplateSeverity(impact: TemplateDeletionImpact): Severity {
  return impact.pendingClaims.count > 0 ? 'high' : 'low';
}

/**
 * Joins claimant names for the "Removed" ledger line:
 * - 1 name: "Alex Rivera"
 * - 2 names: "Alex Rivera & Jordan Lee"
 * - 3+ names: first two full names, then "+N more"
 */
function formatClaimantNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  if (names.length === 2) {
    return `${names[0]} & ${names[1]}`;
  }
  const [first, second, ...rest] = names;
  return `${first}, ${second} +${rest.length} more`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function buildTemplateLedger(
  impact: TemplateDeletionImpact,
  templateName: string
): TemplateLedger {
  const { pendingClaims, scheduledShiftsKept, upcomingOpenSpots } = impact;

  const chips: LedgerChip[] = [];
  const removed: LedgerLine[] = [];
  const kept: LedgerLine[] = [];

  if (pendingClaims.count > 0) {
    chips.push({
      key: 'pendingClaims',
      label: `${pendingClaims.count} ${pluralize(pendingClaims.count, 'pending claim', 'pending claims')}`,
      tone: 'destructive',
    });
    const claimants = formatClaimantNames(pendingClaims.names);
    removed.push({
      key: 'pendingClaims',
      // Only append the claimant list when names actually resolved — otherwise
      // a claim with an unresolved employee join would render a dangling em
      // dash ("… withdrawn — ").
      text: `${pendingClaims.count} ${pluralize(pendingClaims.count, 'pending claim is', 'pending claims are')} withdrawn${claimants ? ` — ${claimants}` : ''}`,
    });
  }

  // Chip always shown (even at zero) so the manager sees "0 open shifts" as
  // confirmation of no impact; the line only appears when there is
  // something real to call out.
  chips.push({
    key: 'openShifts',
    label: `${upcomingOpenSpots} ${pluralize(upcomingOpenSpots, 'open shift', 'open shifts')}`,
    tone: 'warning',
  });
  if (upcomingOpenSpots > 0) {
    removed.push({
      key: 'openShifts',
      text: `${upcomingOpenSpots} upcoming ${pluralize(upcomingOpenSpots, 'open shift stops', 'open shifts stop')} being claimable`,
    });
  }

  // Claim history (approved/rejected/withdrawn, not just pending) is always
  // erased by the CASCADE regardless of whether any claim is pending right
  // now, so this line is unconditional.
  removed.push({
    key: 'claimHistory',
    text: `Claim history for "${templateName}" is erased`,
  });

  chips.push({
    key: 'scheduledShiftsKept',
    label: `${scheduledShiftsKept} ${pluralize(scheduledShiftsKept, 'shift kept', 'shifts kept')}`,
    tone: 'success',
  });
  if (scheduledShiftsKept > 0) {
    kept.push({
      key: 'scheduledShifts',
      text: `${scheduledShiftsKept} already-scheduled ${pluralize(scheduledShiftsKept, 'shift stays', 'shifts stay')} on the calendar`,
    });
    kept.push({
      key: 'assignedKeepShift',
      text: 'Everyone assigned keeps their shift & hours',
    });
  }

  const needsAck = pendingClaims.count > 0;

  return {
    chips,
    removed,
    kept,
    needsAck,
    ackLabel: needsAck
      ? `I understand ${pendingClaims.count} ${pluralize(pendingClaims.count, "employee's pending claim", "employees' pending claims")} will be withdrawn.`
      : null,
  };
}

export interface AvailabilityDeletionInput {
  isAvailable: boolean;
  personName: string;
  timeLabel: string;
  kind: 'availability' | 'exception';
  /** Required when kind === 'availability' (e.g. "Wednesday"). */
  dayLabel?: string;
  /** Required when kind === 'exception' (e.g. "Jul 24"). */
  dateLabel?: string;
}

export interface AvailabilityDeletionCopy {
  severity: Severity;
  heroText: string | null;
  changes: string[];
  needsAck: boolean;
  ackLabel: string | null;
}

/**
 * Two-variant copy keyed on `isAvailable`:
 * - available (open) window/exception: low friction, informational, no ack.
 * - unavailable (blackout) block/exception: guardrail — hero warning + ack,
 *   because deleting it removes a scheduling constraint the employee relied on.
 *
 * `kind` swaps the "when" reference between a recurring weekday (dayLabel)
 * and a one-time exception date (dateLabel) without changing the rest of
 * the copy.
 */
export function describeAvailabilityDeletion(
  input: AvailabilityDeletionInput
): AvailabilityDeletionCopy {
  const { isAvailable, personName, timeLabel, kind, dayLabel, dateLabel } = input;
  const whenLabel = kind === 'exception' ? (dateLabel ?? '') : (dayLabel ?? '');

  if (!isAvailable) {
    return {
      severity: 'high',
      heroText: `This block is a guardrail. ${personName} told you they can't work ${whenLabel} ${timeLabel}. Delete it and the scheduler — plus open-shift claiming — will stop blocking that window.`,
      changes: [
        'Shifts can be scheduled over this time with no warning.',
        'Open-shift claiming no longer treats it as a conflict.',
      ],
      needsAck: true,
      ackLabel: `I understand shifts can be booked during a time ${personName} marked off.`,
    };
  }

  return {
    severity: 'low',
    heroText: null,
    changes: [
      'The scheduler stops suggesting this person for the window.',
      'They can still be scheduled manually.',
      'The posted schedule is unchanged.',
    ],
    needsAck: false,
    ackLabel: null,
  };
}
