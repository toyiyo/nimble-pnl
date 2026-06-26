/**
 * CoverageDetail — popover (desktop) / Drawer (mobile) body.
 *
 * Shows covering employees with clipped intervals and gap segments for a
 * single template slot. Full implementation in Task 10; this stub is
 * imported by ShiftPlannerTab for wiring in Task 8.
 *
 * Design ref: docs/superpowers/specs/2026-06-25-open-shift-coverage-design.md
 * - Heading: "Covering employees for this slot"
 * - Header summary: "{coveragePct}% covered · needs {openSpots} more"
 * - List: name · start–end compact time
 * - Gaps: AlertTriangle icon + "Gap HH:MMa–HH:MMp" (non-color cue per WCAG 1.4.1)
 */
import { AlertTriangle, Users } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import type { SlotCoverage } from '@/types/scheduling';
import { minutesToCompact } from '@/lib/shiftCoverage';

interface CoverageDetailProps {
  open: boolean;
  coverage: SlotCoverage | null;
  /** Human-readable slot label shown in the title, e.g. "Server · 10:00a–4:30p" */
  slotLabel?: string;
  onClose: () => void;
}

export function CoverageDetail({ open, coverage, slotLabel, onClose }: CoverageDetailProps) {
  if (!coverage) return null;

  const { coveragePct, openSpots, coveringEmployees, segments } = coverage;
  const gapSegments = segments.filter((s) => !s.covered);

  const headerText =
    openSpots > 0
      ? `${coveragePct}% covered · needs ${openSpots} more`
      : `${coveragePct}% covered`;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-sm p-0 gap-0 border-border/40">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-semibold text-foreground">
                Covering employees for this slot
              </DialogTitle>
              <DialogDescription className="text-[12px] text-muted-foreground mt-0.5">
                {slotLabel ? `${slotLabel} · ` : ''}{headerText}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3">
          {coveringEmployees.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No employees scheduled for this slot.</p>
          ) : (
            <ul className="space-y-1.5" aria-label="Covering employees">
              {coveringEmployees.map((emp, i) => (
                <li
                  key={`${emp.employeeId}-${i}`}
                  className="flex items-center justify-between text-[13px]"
                >
                  <span className="font-medium text-foreground">
                    {emp.employeeName ?? 'Employee'}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {minutesToCompact(emp.startMin)}–{minutesToCompact(emp.endMin)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {gapSegments.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border/40">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Gaps
              </p>
              {gapSegments.map((seg, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 text-[12px] text-destructive"
                  role="status"
                  aria-label={`Gap from ${minutesToCompact(seg.startMin)} to ${minutesToCompact(seg.endMin)}`}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Gap {minutesToCompact(seg.startMin)}–{minutesToCompact(seg.endMin)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
