import type { ClockAuditFilterClass } from './ClockAuditBar';

/**
 * Tone class per chip class, shared between the filter chips in
 * `ClockAuditBar` and the per-employee row chip in `Payroll.tsx`, so a
 * color change updates both places at once.
 *
 * Lives in its own module (not inside `ClockAuditBar.tsx`) because a value
 * export from a component file breaks React Fast Refresh for that file.
 */
export const AUDIT_TONE_CLASS: Record<ClockAuditFilterClass, string> = {
  to_fix: 'bg-warning/10 text-warning border-warning/20',
  no_clock_out: 'bg-info/10 text-info border-info/20',
  info: 'bg-muted text-muted-foreground border-border/40',
  matched: 'bg-success/10 text-success border-success/20',
};
