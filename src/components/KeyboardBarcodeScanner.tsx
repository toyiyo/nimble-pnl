import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Keyboard, Scan, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createScanAssembler, type ScanAssembler } from '@/lib/barcodeScanInput';

interface KeyboardBarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

export const KeyboardBarcodeScanner: React.FC<KeyboardBarcodeScannerProps> = ({
  onScan,
  onError,
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

    const assembler = createScanAssembler({
      onScan: (code, format) => {
        setLastScan(code);
        setScanCount((c) => c + 1);
        if (input) input.value = '';
        setBuffer('');
        onScanRef.current(code, format);
        window.setTimeout(() => input?.focus(), 100);
      },
      schedule: (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
      clearScheduled: (id) => window.clearTimeout(id),
    });
    assemblerRef.current = assembler;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== input) input?.focus();
      if ((e.key === 'Enter' || e.keyCode === 13) && document.activeElement === input) {
        assembler.enter();
        e.preventDefault();
      }
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
      "w-full border-2 transition-all duration-300",
      isActive
        ? "border-transparent bg-gradient-to-br from-blue-500/10 via-background to-cyan-500/10 shadow-lg shadow-blue-500/10"
        : "border-border"
    )}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              'rounded-lg p-2 transition-all duration-300',
              isActive
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/30 animate-pulse'
                : 'bg-muted'
            )}>
              <Keyboard className={cn('h-5 w-5', isActive ? 'text-white' : 'text-foreground')} />
            </div>
            Keyboard Scanner
          </div>
          {isActive && (
            <Badge className="bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30 animate-pulse">
              <Scan className="h-3 w-3 mr-1" />
              Active
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Use a USB or Bluetooth scanner in keyboard (HID) mode. Works on iOS, Android, and desktop browsers.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Screen-reader announcement of the latest scan (visual UI is otherwise sufficient). */}
        <div aria-live="polite" className="sr-only">
          {lastScan ? `Scanned ${lastScan}` : ''}
        </div>

        {/* Enhanced Scanner Status Area */}
        <div className={cn(
          "min-h-[200px] border-2 rounded-xl flex items-center justify-center relative overflow-hidden transition-all duration-500",
          isActive
            ? "border-blue-500 bg-gradient-to-br from-blue-500/5 to-cyan-500/5"
            : "border-dashed border-border"
        )}>
          {isActive ? (
            <div className="text-center space-y-4 p-4 animate-in fade-in duration-500">
              <div className="relative">
                <div className="text-6xl animate-bounce">⌨️</div>
                <div className="absolute -top-1 -right-1">
                  <div className="h-3 w-3 bg-emerald-500 rounded-full animate-ping" />
                  <div className="absolute top-0 right-0 h-3 w-3 bg-emerald-500 rounded-full" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  Scanner Ready
                </div>
                <div className="text-sm text-muted-foreground max-w-md">
                  Point your Bluetooth HID scanner at a barcode and press the trigger.
                  Each scan opens quick entry dialog for fast inventory updates.
                </div>
              </div>

              {lastScan && (
                <div className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-2 border-emerald-500/30 rounded-xl p-4 mt-4 animate-in slide-in-from-bottom duration-300">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">Last Scanned:</div>
                  <div className="text-lg font-mono font-bold text-foreground">{lastScan}</div>
                </div>
              )}

              <Badge variant="secondary" className="mt-2 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500/30">
                <span className="font-bold">{scanCount}</span> scan{scanCount !== 1 ? 's' : ''} today
              </Badge>

              {buffer && (
                <div className="absolute top-3 left-3 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-700 dark:text-blue-300 px-3 py-1.5 rounded-lg text-xs font-mono border border-blue-500/30">
                  Buffer: {buffer}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="text-6xl opacity-50 grayscale">⌨️</div>
              <div className="space-y-2">
                <div className="text-lg font-medium text-muted-foreground">
                  Scanner Inactive
                </div>
                <div className="text-sm text-muted-foreground max-w-md">
                  Click "Start Scanner" below to begin scanning with your Bluetooth keyboard scanner
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
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Enhanced Control Button */}
        <Button
          onClick={toggleScanner}
          aria-label={isActive ? 'Stop Scanner' : 'Start Scanner'}
          className={cn(
            "w-full transition-all duration-300 hover:scale-[1.02]",
            isActive
              ? "border-red-500/50 text-red-600 hover:bg-red-500/10 hover:border-red-500"
              : "bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 shadow-lg shadow-blue-500/30 text-white"
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

        {/* Enhanced Setup Instructions */}
        {!isActive && (
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 border-2 border-blue-200/50 dark:border-blue-800/50 rounded-xl p-4 space-y-3">
            <div className="font-semibold text-sm text-blue-900 dark:text-blue-100 flex items-center gap-2">
              <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg p-1.5 shadow-lg shadow-blue-500/30">
                <Keyboard className="h-4 w-4 text-white" />
              </div>
              One-Time Setup Instructions:
            </div>
            <ol className="text-xs text-blue-800 dark:text-blue-200 space-y-2 list-decimal list-inside">
              <li className="leading-relaxed">Put your scanner in <strong>Bluetooth HID</strong> (keyboard) mode</li>
              <li className="leading-relaxed">Configure suffix: <strong>Enter/CR</strong></li>
              <li className="leading-relaxed">Optional: Add prefix like <strong>@@</strong> or <strong>]Q</strong></li>
              <li className="leading-relaxed">Pair the scanner via Bluetooth (or plug it in via USB)</li>
              <li className="leading-relaxed">Return to this app and click "Start Scanner"</li>
            </ol>
            <div className="flex items-start gap-2 pt-2 border-t border-blue-200/50 dark:border-blue-800/50">
              <span className="text-lg">ℹ️</span>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Your scanner will appear as a keyboard. This works on <strong>iOS, Android</strong>, and desktop browsers.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
