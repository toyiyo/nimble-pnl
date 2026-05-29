import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';

import { CalendarPlus } from 'lucide-react';

import { ApplyShiftsDialog } from './ApplyShiftsDialog';

import type { MinCrew, ShiftBlock } from '@/types/scheduling';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtHour = (h: number) => {
  const m = h % 24;
  const ampm = m < 12 ? 'AM' : 'PM';
  return `${m % 12 === 0 ? 12 : m % 12}${ampm}`;
};

interface Props {
  blocks: ShiftBlock[];
  minCrew: MinCrew | null;
  restaurantId: string;
  openShiftsEnabled: boolean;
}

export function SuggestedShifts({ blocks, minCrew, restaurantId, openShiftsEnabled }: Readonly<Props>) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const byDay = useMemo(() => {
    const m = new Map<string, ShiftBlock[]>();
    for (const b of blocks) {
      const existing = m.get(b.day);
      if (existing) {
        existing.push(b);
      } else {
        m.set(b.day, [b]);
      }
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <div className="px-4 py-3 border-t border-border/40 text-[13px] text-muted-foreground">
        No consolidated shifts to suggest this week — try lowering your target Sales per Labor Hour.
      </div>
    );
  }

  return (
    <div className="border-t border-border/40">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-[13px] font-semibold text-foreground">Suggested shifts</span>
        <Button
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          onClick={() => setDialogOpen(true)}
        >
          <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
          Apply suggested shifts
        </Button>
      </div>
      <div className="px-4 pb-3 space-y-1.5">
        {byDay.map(([day, dayBlocks]) => (
          <div key={day} className="flex items-center gap-3 text-[13px]">
            <span className="w-10 font-medium text-muted-foreground">
              {DOW[new Date(day + 'T12:00:00').getDay()]}
            </span>
            <span className="text-foreground">
              {dayBlocks.map((b) => `${fmtHour(b.startHour)}–${fmtHour(b.endHour)} (${b.headcount})`).join(', ')}
            </span>
          </div>
        ))}
      </div>
      <ApplyShiftsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        blocks={blocks}
        minCrew={minCrew}
        restaurantId={restaurantId}
        openShiftsEnabled={openShiftsEnabled}
      />
    </div>
  );
}
