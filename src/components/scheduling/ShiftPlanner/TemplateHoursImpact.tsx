import { useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { ChevronRight } from 'lucide-react';

import { SeverityPill } from '@/components/scheduling/SeverityPill';

import type { LedgerTone } from '@/lib/scheduling/deletionCopy';
import type { HoursChangeLedger } from '@/lib/scheduling/hoursChangeCopy';
import type { DriftRow } from '@/lib/scheduling/templateHoursBuckets';

// Chip shape mirrors DeleteTemplateDialog; the tones differ on purpose.
// Untouched shifts here are neutral bookkeeping, not the emerald "kept safe"
// outcome a deletion reports, so `success` reads as muted rather than green.
const CHIP_TONE_CLASSES: Record<LedgerTone, string> = {
  destructive: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  success: 'bg-muted text-muted-foreground',
};

interface TemplateHoursImpactProps {
  ledger: HoursChangeLedger | null;
  drifted: DriftRow[];
  selectedDriftIds: Set<string>;
  onToggleDrift: (shiftId: string) => void;
  publishedCount: number;
  notify: boolean;
  onNotifyChange: (next: boolean) => void;
  isLoading: boolean;
  error: Error | null;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
}

export function TemplateHoursImpact({
  ledger,
  drifted,
  selectedDriftIds,
  onToggleDrift,
  publishedCount,
  notify,
  onNotifyChange,
  isLoading,
  error,
  oldStart,
  oldEnd,
  newStart,
  newEnd,
}: Readonly<TemplateHoursImpactProps>) {
  const [expanded, setExpanded] = useState(false);
  // null means "no manual choice yet", so the default below can depend on `ledger`
  // -- which is null on the first render while the impact query is in flight, and so
  // cannot be read by a useState initialiser that runs exactly once.
  const [driftOpen, setDriftOpen] = useState<boolean | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
        <p className="text-[13px] text-destructive">
          Couldn&apos;t check which shifts this affects. You can still save the template on its own.
        </p>
      </div>
    );
  }

  if (!ledger) return null;

  // When nothing would move on its own, these checkboxes are the only thing the
  // manager can act on -- so they are not hidden behind a third click.
  const driftDefaultOpen = drifted.length > 0 && ledger.totalAffected === 0;
  const isDriftOpen = driftOpen ?? driftDefaultOpen;

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      {/* Collapsed summary. The aria-live region is scoped to this one line:
          a polite region announces its whole subtree on change, so including
          the chips or the panels would re-read the entire ledger on every
          settled keystroke. */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            <SeverityPill severity={ledger.severity} />
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
              {ledger.deltaBadge}
            </span>
            <span aria-live="polite" className="text-[13px] text-muted-foreground truncate">
              {ledger.summary}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="line-through">{oldStart}–{oldEnd}</span>
              <span aria-hidden="true"> → </span>
              <span className="font-medium text-foreground">{newStart}–{newEnd}</span>
            </p>

            <div className="flex flex-wrap gap-1.5">
              {ledger.chips.map((chip) => (
                <span
                  key={chip.key}
                  className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${CHIP_TONE_CLASSES[chip.tone]}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Changes
                </h4>
                <ul className="space-y-1">
                  {ledger.changes.map((line) => (
                    <li key={line.key} className="text-[13px] text-foreground">{line.text}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Untouched
                </h4>
                {ledger.untouched.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Nothing is left behind.</p>
                ) : (
                  <ul className="space-y-1">
                    {ledger.untouched.map((line) => (
                      <li key={line.key} className="text-[13px] text-muted-foreground">{line.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {drifted.length > 0 && (
              <Collapsible open={isDriftOpen} onOpenChange={setDriftOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-[13px] font-medium text-foreground"
                  >
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isDriftOpen ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                    {drifted.length} hand-edited {drifted.length === 1 ? 'shift' : 'shifts'} — your call
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 space-y-2">
                    {drifted.map((row) => {
                      const who = row.employeeName ?? 'Unknown employee';
                      const inputId = `drift-${row.shiftId}`;
                      return (
                        <li key={row.shiftId} className="flex items-center gap-3">
                          <Checkbox
                            id={inputId}
                            checked={selectedDriftIds.has(row.shiftId)}
                            onCheckedChange={() => {
                              // Ticking a row is only reachable while this disclosure is
                              // already open (default or manual), so latching `driftOpen`
                              // to `true` here is always a no-op-or-lock, never a surprise
                              // open. Without it, picking the first of several drifted
                              // shifts flips `ledger.totalAffected` above 0 on the next
                              // render, `driftDefaultOpen` recomputes to `false`, and the
                              // still-null `driftOpen` lets the panel snap shut on the
                              // remaining unpicked checkboxes -- the exact "hidden behind a
                              // third click" outcome this disclosure exists to avoid.
                              setDriftOpen(true);
                              onToggleDrift(row.shiftId);
                            }}
                          />
                          <Label htmlFor={inputId} className="text-[13px] font-normal text-foreground">
                            {who} — {row.localDate}, currently {row.currentStart}–{row.currentEnd}
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}

            {publishedCount > 0 && (
              <div className="flex items-center gap-3 pt-1">
                <Checkbox
                  id="notify-staff"
                  checked={notify}
                  onCheckedChange={(next) => onNotifyChange(next === true)}
                />
                <Label htmlFor="notify-staff" className="text-[13px] font-normal text-foreground">
                  Notify {publishedCount} {publishedCount === 1 ? 'person' : 'staff'} whose posted shift moves
                </Label>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
