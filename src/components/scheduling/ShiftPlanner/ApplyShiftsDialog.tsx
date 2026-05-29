import { useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { CalendarClock } from 'lucide-react';

import { DOW, fmtHour, dayStringToDow, shiftBlocksToTemplates } from '@/lib/staffingApply';
import { useApplySuggestedShifts } from '@/hooks/useApplySuggestedShifts';

import type { MinCrew, ShiftBlock } from '@/types/scheduling';

const blockLabel = (b: ShiftBlock) =>
  `${DOW[dayStringToDow(b.day)]} ${fmtHour(b.startHour)}–${fmtHour(b.endHour)}, ${b.headcount} staff`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: ShiftBlock[];
  minCrew: MinCrew | null;
  restaurantId: string;
  openShiftsEnabled: boolean;
}

export function ApplyShiftsDialog({
  open,
  onOpenChange,
  blocks,
  minCrew,
  restaurantId,
  openShiftsEnabled,
}: Readonly<Props>) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const { applyShifts, isApplying } = useApplySuggestedShifts(restaurantId);

  const selected = useMemo(() => blocks.filter((_, i) => !excluded.has(i)), [blocks, excluded]);
  // Align with distributePositions: only positions with weight > 0 count as "crew configured"
  const hasCrew = !!minCrew && Object.values(minCrew).some((w) => w > 0);

  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });

  // Reset the per-block selection whenever the dialog closes (cancel, confirm,
  // Esc, or backdrop click) so a reopened dialog never inherits stale exclusions.
  const handleOpenChange = (next: boolean) => {
    if (!next) setExcluded(new Set());
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    const rows = shiftBlocksToTemplates(selected, minCrew, restaurantId);
    await applyShifts(rows);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] p-0 gap-0 border-border/40 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarClock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Apply suggested shifts
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Creates open shifts you can assign or let staff claim.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-2 overflow-y-auto flex-1">
          {!hasCrew && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-muted-foreground">
              No Minimum Crew set — these will be created as generic &ldquo;Staff&rdquo; shifts. Set a crew to split by role.
            </div>
          )}
          {!openShiftsEnabled && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[12px] text-muted-foreground">
              Created shifts appear in your template grid now. Enable Open Shift Claiming for staff to claim them.
            </div>
          )}
          {blocks.map((b, i) => (
            <label
              key={`${b.day}-${b.startHour}-${b.endHour}`}
              className="flex items-center gap-3 p-2.5 rounded-lg border border-border/40 hover:border-border transition-colors cursor-pointer"
            >
              <Checkbox
                checked={!excluded.has(i)}
                onCheckedChange={() => toggle(i)}
                aria-label={`Include ${blockLabel(b)}`}
              />
              <span className="text-[14px] font-medium text-foreground">{blockLabel(b)}</span>
            </label>
          ))}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            disabled={selected.length === 0 || isApplying}
            onClick={handleConfirm}
          >
            {(() => {
              if (isApplying) return 'Creating…';
              const suffix = selected.length === 1 ? '' : 's';
              return `Create ${selected.length} shift${suffix}`;
            })()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
