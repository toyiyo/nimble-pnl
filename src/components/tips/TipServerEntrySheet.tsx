import { useEffect, useState, useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, Calculator } from 'lucide-react';
import { format } from 'date-fns';

import type { Employee } from '@/types/scheduling';

export interface TipServerEntrySheetProps {
  readonly open: boolean;
  readonly date: Date;
  readonly servers: Employee[];
  readonly initialEarnings?: Map<string, number>; // employeeId -> dollars
  readonly loading?: boolean;
  readonly onCalculate: (earnings: Array<{ employeeId: string; name: string; amountCents: number }>) => void;
  readonly onClose: () => void;
}

export function TipServerEntrySheet({
  open,
  date,
  servers,
  initialEarnings,
  loading = false,
  onCalculate,
  onClose,
}: TipServerEntrySheetProps) {
  // Map of employeeId -> dollar string (keep as string to avoid input quirks)
  const [earnings, setEarnings] = useState<Map<string, string>>(new Map());

  // Sync initial earnings when sheet opens or date/servers change
  useEffect(() => {
    const next = new Map<string, string>();
    for (const server of servers) {
      const initial = initialEarnings?.get(server.id);
      next.set(server.id, initial != null && initial > 0 ? initial.toFixed(2) : '');
    }
    setEarnings(next);
  }, [servers, initialEarnings, date]);

  const handleChange = useCallback((employeeId: string, value: string) => {
    setEarnings(prev => {
      const next = new Map(prev);
      next.set(employeeId, value);
      return next;
    });
  }, []);

  const runningTotalDollars = useMemo(() => {
    let total = 0;
    for (const val of earnings.values()) {
      const parsed = Number.parseFloat(val);
      if (!Number.isNaN(parsed) && parsed > 0) {
        total += parsed;
      }
    }
    return total;
  }, [earnings]);

  const handleCalculate = useCallback(() => {
    const result: Array<{ employeeId: string; name: string; amountCents: number }> = [];
    for (const server of servers) {
      const raw = earnings.get(server.id) ?? '';
      const dollars = Number.parseFloat(raw);
      const cents = !Number.isNaN(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
      result.push({ employeeId: server.id, name: server.name, amountCents: cents });
    }
    onCalculate(result);
  }, [servers, earnings, onCalculate]);

  const isCalculateDisabled = loading || runningTotalDollars <= 0;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="max-w-md w-full p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Calculator className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <SheetTitle className="text-[17px] font-semibold text-foreground">
                Enter Server Tips
              </SheetTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {format(date, 'EEE, MMM d')}
              </p>
            </div>
          </div>
        </SheetHeader>

        {/* Scrollable server list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Info alert */}
          <Alert className="mb-4 border-border/40">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-[13px]">
              Enter each server's total tips for the day. Pool contributions will be calculated automatically.
            </AlertDescription>
          </Alert>

          {/* Server rows */}
          <div className="space-y-0">
            {servers.map(server => (
              <div
                key={server.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-border/40 last:border-b-0"
              >
                <span className="text-[14px] font-medium text-foreground">
                  {server.name}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[13px] text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={earnings.get(server.id) ?? ''}
                    onChange={e => handleChange(server.id, e.target.value)}
                    className="w-28 h-9 text-right text-[14px] bg-muted/30 border-border/40 rounded-lg"
                    placeholder="0.00"
                    aria-label={`Tips for ${server.name}`}
                  />
                </div>
              </div>
            ))}

            {servers.length === 0 && (
              <p className="text-[13px] text-muted-foreground text-center py-6">
                No tip-eligible servers found for this day.
              </p>
            )}
          </div>
        </div>

        {/* Footer: running total + button */}
        <div className="border-t border-border/40 px-6 py-4 space-y-4">
          {/* Running total */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/30">
            <span className="text-[14px] font-medium text-foreground">Total</span>
            <span className="text-[17px] font-semibold text-foreground">
              ${runningTotalDollars.toFixed(2)}
            </span>
          </div>

          {/* Calculate button */}
          <Button
            onClick={handleCalculate}
            disabled={isCalculateDisabled}
            className="w-full h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            aria-label="Calculate tip split"
          >
            {loading ? 'Calculating...' : 'Calculate Split'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
