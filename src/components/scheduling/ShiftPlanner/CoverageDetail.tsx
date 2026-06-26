/**
 * CoverageDetail — Popover (desktop, anchored to cell rect) / Drawer (mobile) body.
 *
 * Shows covering employees with clipped intervals and gap segments for a
 * single template slot. Desktop renders a shadcn Popover anchored to the
 * cell's bounding rect; mobile renders a shadcn Drawer (bottom sheet). Uses
 * useIsMobile to branch.
 *
 * Design ref: docs/superpowers/specs/2026-06-25-open-shift-coverage-design.md
 * - Heading: "Covering employees for this slot"
 * - Header summary: "{coveragePct}% covered · needs {openSpots} more" (or just "{pct}% covered")
 * - List: name · start–end compact time
 * - Gaps: AlertTriangle icon + "Gap HH:MMa–HH:MMp" (non-color cue per WCAG 1.4.1)
 */
import { useRef, useEffect } from 'react';
import { AlertTriangle, Users } from 'lucide-react';

import {
  Popover,
  PopoverContent,
} from '@/components/ui/popover';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';

import { useIsMobile } from '@/hooks/use-mobile';
import type { SlotCoverage } from '@/types/scheduling';
import { minutesToCompact } from '@/lib/shiftCoverage';

interface CoverageDetailProps {
  open: boolean;
  coverage: SlotCoverage | null;
  /** Human-readable slot label shown in the title, e.g. "Server · 10:00a–4:30p" */
  slotLabel?: string;
  /** Bounding rect of the cell that triggered this panel (desktop anchor). */
  anchorRect?: DOMRect;
  onClose: () => void;
}

/** Employee list + gap segments (shared between Popover and Drawer layouts). */
function CoverageList({ coverage }: { coverage: SlotCoverage }) {
  const { coveringEmployees, segments } = coverage;
  const gapSegments = segments.filter((s) => !s.covered);

  return (
    <div className="space-y-3">
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
              aria-label={`Gap from ${minutesToCompact(seg.startMin)} to ${minutesToCompact(seg.endMin)}`}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Gap {minutesToCompact(seg.startMin)}–{minutesToCompact(seg.endMin)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CoverageDetail({ open, coverage, slotLabel, anchorRect, onClose }: CoverageDetailProps) {
  const isMobile = useIsMobile();
  // Virtual anchor element positioned at the cell's bounding rect
  const virtualAnchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (virtualAnchorRef.current && anchorRect) {
      // Reposition the virtual anchor to match the cell's rect on each open
      const el = virtualAnchorRef.current;
      el.style.position = 'fixed';
      el.style.top = `${anchorRect.top}px`;
      el.style.left = `${anchorRect.left}px`;
      el.style.width = `${anchorRect.width}px`;
      el.style.height = `${anchorRect.height}px`;
    }
  }, [anchorRect, open]);

  if (!coverage) return null;

  const { coveragePct, openSpots } = coverage;
  const headerText =
    openSpots > 0
      ? `${coveragePct}% covered · needs ${openSpots} more`
      : `${coveragePct}% covered`;

  // Mobile: bottom Drawer
  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <DrawerContent className="px-5 pb-6">
          <DrawerHeader className="px-0 pb-3 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-foreground" />
              </div>
              <div>
                <DrawerTitle className="text-[17px] font-semibold text-foreground text-left">
                  Covering employees for this slot
                </DrawerTitle>
                <DrawerDescription className="text-[12px] text-muted-foreground mt-0.5 text-left">
                  {slotLabel ? `${slotLabel} · ` : ''}{headerText}
                </DrawerDescription>
              </div>
            </div>
          </DrawerHeader>
          <div className="pt-4">
            <CoverageList coverage={coverage} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: Popover anchored to the cell's bounding rect via a virtual anchor element.
  // We use PopoverPrimitive.Anchor to attach PopoverContent to the virtual span.
  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      {/* Virtual anchor element — invisible, positioned at the cell rect */}
      <PopoverPrimitive.Anchor asChild>
        <span
          ref={virtualAnchorRef}
          aria-hidden="true"
          style={{ pointerEvents: 'none' }}
        />
      </PopoverPrimitive.Anchor>
      <PopoverContent
        className="w-80 p-0 border-border/40"
        side="bottom"
        align="start"
        sideOffset={4}
        aria-label="Covering employees for this slot"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-foreground">
                Covering employees for this slot
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {slotLabel ? `${slotLabel} · ` : ''}{headerText}
              </p>
            </div>
          </div>
        </div>
        {/* Body */}
        <div className="px-4 py-3">
          <CoverageList coverage={coverage} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
