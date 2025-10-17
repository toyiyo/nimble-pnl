import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Keyboard, Scan, Check, X, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  autoStart = false
}) => {
  const [isActive, setIsActive] = useState(autoStart);
  const [buffer, setBuffer] = useState('');
  const [lastScan, setLastScan] = useState<string>('');
  const [scanCount, setScanCount] = useState(0);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef('');

  // Focus the hidden input whenever needed
  const focusHiddenInput = useCallback(() => {
    if (hiddenInputRef.current && isActive) {
      hiddenInputRef.current.focus();
    }
  }, [isActive]);

  // Handle parsed barcode
  const handleBarcode = useCallback((code: string) => {
    // Strip optional prefix like "@@" or "]Q"
    const cleanCode = code.replace(/^(@@|]Q)/, '').trim();
    
    if (cleanCode.length > 0) {
      setLastScan(cleanCode);
      setScanCount(prev => prev + 1);
      onScan(cleanCode, 'KeyboardHID');
      
      // Reset buffer
      bufferRef.current = '';
      setBuffer('');
      
      // Refocus after short delay
      setTimeout(focusHiddenInput, 100);
    } else {
      onError?.(`Empty barcode scan`);
    }
  }, [onScan, onError, focusHiddenInput]);

  // Handle keydown events
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive) return;

    // Ensure hidden input has focus
    if (document.activeElement !== hiddenInputRef.current) {
      focusHiddenInput();
    }

    if (e.key === 'Enter') {
      const raw = bufferRef.current.trim();
      if (raw) {
        handleBarcode(raw);
      }
      e.preventDefault();
    } else if (e.key.length === 1) {
      bufferRef.current += e.key;
      setBuffer(bufferRef.current);
    } else if (e.key === 'Backspace') {
      bufferRef.current = bufferRef.current.slice(0, -1);
      setBuffer(bufferRef.current);
    }
  }, [isActive, handleBarcode, focusHiddenInput]);

  // Set up event listeners
  useEffect(() => {
    if (!isActive) return;

    // Focus management
    const handlePointerDown = () => focusHiddenInput();
    const handleFocus = () => focusHiddenInput();
    const handleVisibilityChange = () => {
      if (!document.hidden) focusHiddenInput();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('keydown', handleKeyDown);

    // Initial focus
    focusHiddenInput();

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, handleKeyDown, focusHiddenInput]);

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
            Keyboard Scanner (iOS Compatible)
          </div>
          {isActive && (
            <Badge className="bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30 animate-pulse">
              <Scan className="h-3 w-3 mr-1" />
              Active
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Use a Bluetooth scanner in keyboard (HID) mode. Works on all devices including iOS.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
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

        {/* Hidden input for capturing scans */}
        <Input
          ref={hiddenInputRef}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="opacity-0 absolute -left-[10000px] pointer-events-none"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Enhanced Control Button */}
        <Button
          onClick={toggleScanner}
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
              <li className="leading-relaxed">Pair scanner in iOS Settings → Bluetooth</li>
              <li className="leading-relaxed">Return to this app and click "Start Scanner"</li>
            </ol>
            <div className="flex items-start gap-2 pt-2 border-t border-blue-200/50 dark:border-blue-800/50">
              <span className="text-lg">ℹ️</span>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Your scanner will appear as a keyboard. This works on <strong>all iOS devices</strong> (iPhone/iPad) and all browsers.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
