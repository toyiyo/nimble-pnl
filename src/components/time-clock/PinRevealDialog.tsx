import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KeyRound, AlertTriangle, Copy, Check, Printer } from 'lucide-react';

export interface RevealedPin {
  employeeId: string;
  name: string;
  position?: string | null;
  pin: string;
}

interface PinRevealDialogProps {
  open: boolean;
  pins: RevealedPin[];
  onOpenChange: (open: boolean) => void;
}

const formatBulk = (pins: RevealedPin[]) =>
  pins.map((p) => `${p.name} — ${p.pin}`).join('\n');

export function PinRevealDialog({ open, pins, onOpenChange }: PinRevealDialogProps) {
  const [announce, setAnnounce] = useState('');
  // Bumped on every announce so repeated identical strings still re-fire screen-reader output.
  const [announceSeq, setAnnounceSeq] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const clearCopiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clearCopiedTimer.current) window.clearTimeout(clearCopiedTimer.current);
    },
    []
  );

  const announceMessage = (msg: string) => {
    setAnnounce(msg);
    setAnnounceSeq((s) => s + 1);
  };

  const copyOne = async (p: RevealedPin) => {
    try {
      await navigator.clipboard.writeText(p.pin);
      setCopiedId(p.employeeId);
      announceMessage(`PIN for ${p.name} copied.`);
      if (clearCopiedTimer.current) window.clearTimeout(clearCopiedTimer.current);
      clearCopiedTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      announceMessage(`Copy failed — please copy ${p.pin} manually.`);
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(formatBulk(pins));
      announceMessage(`Copied ${pins.length} PIN${pins.length === 1 ? '' : 's'}.`);
    } catch {
      announceMessage('Copy failed — please use Print instead.');
    }
  };

  const print = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] p-0 gap-0 border-border/40 overflow-hidden print:max-w-none print:max-h-none print:border-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40 print:hidden">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                PINs ready to share
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Distribute these now — they're hashed after you close.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 print:hidden">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-[13px] text-amber-800 dark:text-amber-300">
              You won't see these PINs again after closing this dialog.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto print:overflow-visible">
          <ul className="space-y-2 print:space-y-0">
            {pins.map((p, i) => {
              const justCopied = copiedId === p.employeeId;
              return (
                <li
                  key={p.employeeId}
                  className="reveal-row group flex items-center justify-between gap-3 p-4 rounded-xl border border-border/40 bg-background print:rounded-none print:border-0 print:border-b print:break-inside-avoid print:py-6"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-foreground truncate">
                      {p.name}
                    </div>
                    {p.position && (
                      <div className="text-[12px] text-muted-foreground truncate">
                        {p.position}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[28px] font-mono tracking-[0.3em] text-foreground print:text-[48px]">
                      {p.pin}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyOne(p)}
                      aria-label={`Copy PIN for ${p.name}`}
                      className="print:hidden"
                    >
                      {justCopied ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announce}
          <span aria-hidden="true" style={{ display: 'none' }}>{announceSeq}</span>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/40 bg-background sticky bottom-0 print:hidden">
          <Button variant="ghost" onClick={print} className="text-[13px] font-medium">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" onClick={copyAll} className="text-[13px] font-medium">
            <Copy className="h-4 w-4 mr-2" />
            Copy all
          </Button>
          <Button onClick={() => onOpenChange(false)} className="text-[13px] font-medium">
            Done
          </Button>
        </div>

        <style>{`
          @keyframes reveal-in {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .reveal-row {
            opacity: 0;
            animation: reveal-in 240ms ease-out forwards;
          }
          @media (prefers-reduced-motion: reduce) {
            .reveal-row { animation: none; opacity: 1; }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
