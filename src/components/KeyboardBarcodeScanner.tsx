import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Keyboard, Scan, Check, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createScanAssembler, type ScanAssembler } from '@/lib/barcodeScanInput';

interface KeyboardBarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  className?: string;
  autoStart?: boolean;
}

export const KeyboardBarcodeScanner: React.FC<KeyboardBarcodeScannerProps> = ({
  onScan,
  className,
  autoStart = false,
}) => {
  const [isActive, setIsActive] = useState(autoStart);
  const [buffer, setBuffer] = useState('');
  const [lastScan, setLastScan] = useState<string>('');
  const [scanCount, setScanCount] = useState(0);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const assemblerRef = useRef<ScanAssembler | null>(null);

  // Keep a stable reference to onScan so the assembler/listeners never go stale.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Build the assembler + wire global listeners while the scanner is active.
  useEffect(() => {
    if (!isActive) return;
    const input = hiddenInputRef.current;

    // Track the post-scan refocus timer so the effect cleanup can cancel it.
    let refocusTimerId: number | null = null;

    const assembler = createScanAssembler({
      onScan: (code, format) => {
        setLastScan(code);
        setScanCount((c) => c + 1);
        if (input) input.value = '';
        setBuffer('');
        onScanRef.current(code, format);
        // Allow the DOM to settle before refocusing the capture input.
        if (refocusTimerId !== null) window.clearTimeout(refocusTimerId);
        refocusTimerId = window.setTimeout(() => { refocusTimerId = null; input?.focus(); }, 100);
      },
      schedule: (cb, ms) => window.setTimeout(cb, ms),
      clearScheduled: (id) => window.clearTimeout(id),
      onReject: () => {
        // Clear the hidden input when an idle-timeout buffer is rejected (too short).
        // Without this, stale text accumulates and the next scan reads a corrupted string.
        if (input) input.value = '';
        setBuffer('');
      },
    });
    assemblerRef.current = assembler;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check Enter guard first — only flush when the hidden input already owns focus.
      // Moving focus() *after* the check avoids unconditionally stealing Enter from
      // overlapping form elements or modal dialogs.
      if ((e.key === 'Enter' || e.keyCode === 13) && document.activeElement === input) {
        assembler.enter();
        e.preventDefault();
        return;
      }
      // For all other keys, steal focus back to the hidden capture input.
      if (document.activeElement !== input) input?.focus();
    };
    const refocus = () => input?.focus();
    const handleVisibility = () => {
      if (!document.hidden) input?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', refocus);
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', handleVisibility);
    input?.focus();

    return () => {
      assembler.dispose();
      assemblerRef.current = null;
      if (refocusTimerId !== null) window.clearTimeout(refocusTimerId);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', refocus);
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive]);

  const toggleScanner = () => {
    setIsActive(!isActive);
    if (!isActive) {
      setScanCount(0);
      setLastScan('');
    }
  };

  return (
    <Card className={cn(
      "w-full border transition-colors",
      isActive ? "border-border bg-muted/20" : "border-border/40"
    )}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              'h-10 w-10 rounded-xl flex items-center justify-center transition-colors',
              isActive ? 'bg-foreground' : 'bg-muted/50'
            )}>
              <Keyboard className={cn('h-5 w-5', isActive ? 'text-background' : 'text-foreground')} />
            </div>
            <span className="text-[17px] font-semibold text-foreground">Keyboard Scanner</span>
          </div>
          {isActive && (
            <Badge variant="secondary" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
              <Scan className="h-3 w-3 mr-1" />
              Active
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-[13px] text-muted-foreground">
          Use a USB or Bluetooth scanner in keyboard (HID) mode. Works on iOS, Android, and desktop browsers.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Screen-reader announcement of the latest scan (visual UI is otherwise sufficient). */}
        <div aria-live="polite" className="sr-only">
          {lastScan ? `Scanned ${lastScan}` : ''}
        </div>

        {/* Scanner Status Area */}
        <div className={cn(
          "min-h-[200px] border rounded-xl flex items-center justify-center relative overflow-hidden transition-colors",
          isActive ? "border-border bg-muted/10" : "border-dashed border-border/40"
        )}>
          {isActive ? (
            <div className="text-center space-y-4 p-4 animate-in fade-in duration-500">
              <div className="relative inline-flex items-center justify-center">
                <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                  <Keyboard className="h-8 w-8 text-foreground" />
                </div>
                <div className="absolute -top-1 -right-1">
                  <div className="h-3 w-3 bg-foreground rounded-full animate-ping opacity-60" />
                  <div className="absolute top-0 right-0 h-3 w-3 bg-foreground rounded-full" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[15px] font-semibold text-foreground">
                  Scanner Ready
                </div>
                <div className="text-[13px] text-muted-foreground max-w-md">
                  Point your Bluetooth HID scanner at a barcode and press the trigger.
                  Each scan opens the quick entry dialog for fast inventory updates.
                </div>
              </div>

              {lastScan && (
                <div className="border border-border/40 rounded-xl p-4 mt-4 bg-muted/30 animate-in slide-in-from-bottom duration-300">
                  <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Last Scanned</div>
                  <div className="text-[14px] font-mono font-medium text-foreground">{lastScan}</div>
                </div>
              )}

              <Badge variant="secondary" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
                <span className="font-bold">{scanCount}</span>&nbsp;scan{scanCount !== 1 ? 's' : ''}
              </Badge>

              {buffer && (
                <div className="absolute top-3 left-3 bg-muted/60 text-muted-foreground px-3 py-1.5 rounded-lg text-[11px] font-mono border border-border/40">
                  Buffer: {buffer}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center space-y-3">
              <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto opacity-50">
                <Keyboard className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <div className="text-[15px] font-medium text-muted-foreground">
                  Scanner Inactive
                </div>
                <div className="text-[13px] text-muted-foreground max-w-md">
                  Click &ldquo;Start Scanner&rdquo; below to begin scanning with your Bluetooth keyboard scanner
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hidden input that captures scanner keystrokes (works through Android IME via value). */}
        <Input
          ref={hiddenInputRef}
          onInput={(e) => {
            const v = e.currentTarget.value;
            assemblerRef.current?.feed(v);
            setBuffer(v);
          }}
          onCompositionStart={() => assemblerRef.current?.setComposing(true)}
          onCompositionEnd={(e) => {
            const v = e.currentTarget.value;
            assemblerRef.current?.feed(v);
            assemblerRef.current?.setComposing(false);
            setBuffer(v);
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="opacity-0 absolute -left-[10000px] pointer-events-none"
          aria-label="Barcode scanner capture input"
          tabIndex={-1}
        />

        {/* Control Button */}
        <Button
          onClick={toggleScanner}
          aria-label={isActive ? 'Stop Scanner' : 'Start Scanner'}
          className={cn(
            "w-full h-9 px-4 rounded-lg text-[13px] font-medium transition-colors",
            isActive
              ? "text-destructive hover:text-destructive/80"
              : "bg-foreground text-background hover:bg-foreground/90"
          )}
          variant={isActive ? 'outline' : 'default'}
        >
          {isActive ? (
            <>
              <X className="h-4 w-4 mr-2" />
              Stop Scanner
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Start Scanner
            </>
          )}
        </Button>

        {/* Setup Instructions */}
        {!isActive && (
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-muted flex items-center justify-center">
                <Keyboard className="h-3.5 w-3.5 text-foreground" />
              </div>
              <h3 className="text-[13px] font-semibold text-foreground">One-Time Setup Instructions</h3>
            </div>
            <div className="p-4 space-y-3">
              <ol className="text-[13px] text-muted-foreground space-y-2 list-decimal list-inside">
                <li className="leading-relaxed">Put your scanner in <strong className="text-foreground">Bluetooth HID</strong> (keyboard) mode</li>
                <li className="leading-relaxed">Configure suffix: <strong className="text-foreground">Enter/CR</strong></li>
                <li className="leading-relaxed">Optional: Add prefix like <strong className="text-foreground">@@</strong> or <strong className="text-foreground">]Q</strong></li>
                <li className="leading-relaxed">Pair the scanner via Bluetooth (or plug it in via USB)</li>
                <li className="leading-relaxed">Return to this app and click &ldquo;Start Scanner&rdquo;</li>
              </ol>
              <div className="flex items-start gap-2 pt-2 border-t border-border/40">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-[13px] text-muted-foreground">
                  Your scanner will appear as a keyboard. This works on <strong className="text-foreground">iOS, Android</strong>, and desktop browsers.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
