/**
 * Pure copy/severity builders for the template-hours cascade ledger, the
 * sibling of deletionCopy.ts. Reuses that module's Severity/LedgerChip/
 * LedgerLine types rather than duplicating them, so edit and delete render
 * identically.
 *
 * Deliberately does NOT produce the drift rows: LedgerLine is `{ key, text }`,
 * with nowhere to hang the shiftId the checkbox selection and the RPC argument
 * both need. Those come straight off `bucketTemplateShifts`' DriftRow[].
 *
 * See docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.
 */

import { durationMinutes, toMinutes } from '@/lib/scheduling/templateHoursBuckets';
import { pluralize, type LedgerChip, type LedgerLine, type Severity } from '@/lib/scheduling/deletionCopy';

export interface HoursChangeInput {
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  movingCount: number;
  /**
   * Published shifts among the shifts that will actually move — the moving
   * bucket plus any opted-in drifted shift that is itself published. Not
   * scoped to the moving bucket alone, or a manager who opts a posted
   * drifted shift in would see severity and the notify count understate it.
   */
  publishedCount: number;
  pastCount: number;
  lockedCount: number;
  driftedCount: number;
  selectedDriftCount: number;
  /** Signed scheduled-hours change, moving set plus opted-in drift. */
  hoursDelta: number;
}

export interface HoursChangeLedger {
  severity: Severity;
  chips: LedgerChip[];
  changes: LedgerLine[];
  untouched: LedgerLine[];
  /** The one sentence the aria-live region announces. */
  summary: string;
  /** Neutral fact, NOT a LedgerChip — see the spec on why tone would mislead. */
  deltaBadge: string;
  totalAffected: number;
}

/**
 * Keys on posted shifts, not on raw count — same reasoning as
 * deriveTemplateSeverity keying on pending claims. A posted shift is a promise
 * made to a person; forty unposted shifts are less consequential than one
 * posted one.
 */
export function deriveHoursChangeSeverity(publishedCount: number): Severity {
  return publishedCount > 0 ? 'high' : 'low';
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function buildDeltaBadge(
  oldStart: string,
  oldEnd: string,
  newStart: string,
  newEnd: string
): string {
  const startShift = toMinutes(newStart) - toMinutes(oldStart);
  const lengthDelta = durationMinutes(newStart, newEnd) - durationMinutes(oldStart, oldEnd);

  const parts: string[] = [];
  if (startShift !== 0) {
    parts.push(`${formatMinutes(Math.abs(startShift))} ${startShift > 0 ? 'later' : 'earlier'}`);
  }
  if (lengthDelta !== 0) {
    parts.push(`${formatMinutes(Math.abs(lengthDelta))} ${lengthDelta > 0 ? 'longer' : 'shorter'}`);
  } else if (parts.length > 0) {
    parts.push('same length');
  }

  return parts.length > 0 ? parts.join(' · ') : 'no change';
}

export function formatHoursDelta(hours: number): string {
  if (hours === 0) return 'No change in scheduled hours';
  const sign = hours > 0 ? '+' : '-';
  return `${sign}${Math.abs(hours)} scheduled hours`;
}

/**
 * Extra toast sentence for when the cascade moved fewer shifts than the
 * dialog promised. `promisedCount` is the ledger's `totalAffected` at the
 * instant the manager clicked Save; `updatedCount` is the RPC's
 * `updated_count`. The gap has two independent causes the client can't tell
 * apart after the fact — a moving shift's start crossed into the past
 * between preview and save (the ledger's `now` goes stale while the dialog
 * is open), or a re-validated opted-in drift id was dropped server-side
 * (`skipped_count`) — so the copy names neither and just reports the gap.
 * Undefined when nothing was promised or the counts already match, so the
 * caller can append it conditionally without an extra branch.
 */
export function describeCascadeShortfall(
  promisedCount: number,
  updatedCount: number,
): string | undefined {
  if (promisedCount <= updatedCount) return undefined;
  return `You expected ${promisedCount}, but only ${updatedCount} were still eligible when it saved.`;
}

/**
 * Label for the dialog's primary save button. Lives here, not in the dialog
 * component, because it is a pure copy builder over the same
 * showCascadeChoice/affectedCount values the rest of this module turns into
 * ledger copy, and every other pure copy builder for this feature is unit
 * tested from this file.
 */
export function buildSaveButtonLabel(params: {
  isSubmitting: boolean;
  showCascadeChoice: boolean;
  affectedCount: number;
  isEdit: boolean;
}): string {
  const { isSubmitting, showCascadeChoice, affectedCount, isEdit } = params;
  if (isSubmitting) return 'Saving...';
  if (showCascadeChoice) {
    return `Save & update ${affectedCount} ${pluralize(affectedCount, 'shift', 'shifts')}`;
  }
  if (isEdit) return 'Save changes';
  return 'Add Template';
}

export function buildHoursChangeLedger(input: HoursChangeInput): HoursChangeLedger {
  const {
    oldStart, oldEnd, newStart, newEnd,
    movingCount, publishedCount, pastCount, lockedCount,
    driftedCount, selectedDriftCount, hoursDelta,
  } = input;

  const severity = deriveHoursChangeSeverity(publishedCount);
  const deltaBadge = buildDeltaBadge(oldStart, oldEnd, newStart, newEnd);
  const totalAffected = movingCount + selectedDriftCount;

  const chips: LedgerChip[] = [];
  if (publishedCount > 0) {
    chips.push({
      key: 'published',
      label: `${publishedCount} already posted`,
      tone: 'destructive',
    });
  }
  // Always shown, even at zero, so the manager reads "0 shifts move" as
  // confirmation of no impact rather than as a missing chip.
  chips.push({
    key: 'moving',
    label: `${movingCount} ${pluralize(movingCount, 'shift moves', 'shifts move')}`,
    tone: 'warning',
  });
  const untouchedCount = pastCount + lockedCount + (driftedCount - selectedDriftCount);
  chips.push({
    key: 'untouched',
    label: `${untouchedCount} untouched`,
    tone: 'success',
  });

  const changes: LedgerLine[] = [];
  if (movingCount > 0) {
    changes.push({
      key: 'moving',
      text: `${movingCount} ${pluralize(movingCount, 'shift moves', 'shifts move')} to ${newStart}–${newEnd}`,
    });
  }
  if (selectedDriftCount > 0) {
    changes.push({
      key: 'selectedDrift',
      text: `${selectedDriftCount} hand-edited ${pluralize(selectedDriftCount, 'shift you picked moves', 'shifts you picked move')} too`,
    });
  }
  if (publishedCount > 0) {
    changes.push({
      key: 'published',
      text: `${publishedCount} of these ${pluralize(publishedCount, 'shift has', 'shifts have')} already been posted to staff`,
    });
  }
  changes.push({ key: 'hours', text: formatHoursDelta(hoursDelta) });

  const untouched: LedgerLine[] = [];
  if (pastCount > 0) {
    untouched.push({
      key: 'past',
      text: `${pastCount} past ${pluralize(pastCount, 'shift stays', 'shifts stay')} as scheduled — payroll has seen them`,
    });
  }
  if (lockedCount > 0) {
    untouched.push({
      key: 'locked',
      text: `${lockedCount} locked ${pluralize(lockedCount, 'shift stays', 'shifts stay')} as scheduled`,
    });
  }
  const unpickedDrift = driftedCount - selectedDriftCount;
  if (unpickedDrift > 0) {
    untouched.push({
      key: 'drifted',
      text: `${unpickedDrift} hand-edited ${pluralize(unpickedDrift, 'shift stays', 'shifts stay')} as scheduled unless you pick them`,
    });
  }

  const severityLabel = severity === 'high' ? 'High impact' : 'Low impact';
  const movingClause = `${totalAffected} ${pluralize(totalAffected, 'shift moves', 'shifts move')}`;
  const summary = publishedCount > 0
    ? `${severityLabel}. ${deltaBadge}. ${movingClause}, ${publishedCount} already posted.`
    : `${severityLabel}. ${deltaBadge}. ${movingClause}.`;

  return { severity, chips, changes, untouched, summary, deltaBadge, totalAffected };
}
