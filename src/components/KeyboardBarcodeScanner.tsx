import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Keyboard, Scan, Check, X } from 'lucide-react';
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
    
    if (cleanCode.length >= 8 && /^\d+$/.test(cleanCode)) {
      setLastScan(cleanCode);
      setScanCount(prev => prev + 1);
      onScan(cleanCode, 'KeyboardHID');
      
      // Reset buffer
      bufferRef.current = '';
      setBuffer('');
      
      // Refocus after short delay
      setTimeout(focusHiddenInput, 100);
    } else {
      onError?.(`Invalid barcode format: ${cleanCode}`);
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
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Scanner (iOS Compatible)
          </div>
          {isActive && (
            <Badge variant="default" className="bg-green-500">
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
        {/* Scanner Status Area */}
        <div className="min-h-[200px] border-2 border-dashed rounded-lg flex items-center justify-center relative bg-background">
          {isActive ? (
            <div className="text-center space-y-4 p-4">
              <div className="text-6xl">⌨️</div>
              <div className="text-lg font-medium text-green-600">
                Scanner Ready
              </div>
              <div className="text-sm text-muted-foreground max-w-md">
                Point your Bluetooth HID scanner at a barcode and press the trigger.
                Each scan opens quick entry dialog for fast inventory updates.
              </div>
              
              {lastScan && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-4">
                  <div className="text-xs text-green-600 font-medium mb-1">Last Scanned:</div>
                  <div className="text-lg font-mono">{lastScan}</div>
                </div>
              )}
              
              <Badge variant="outline" className="mt-2">
                Scans: {scanCount}
              </Badge>

              {buffer && (
                <div className="absolute top-2 left-2 bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-mono">
                  Buffer: {buffer}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="text-6xl opacity-50">⌨️</div>
              <div className="text-lg font-medium text-muted-foreground">
                Scanner Inactive
              </div>
              <div className="text-sm text-muted-foreground max-w-md">
                Click "Start Scanner" below to begin scanning with your Bluetooth keyboard scanner
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

        {/* Control Button */}
        <Button
          onClick={toggleScanner}
          className="w-full"
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <div className="font-medium text-sm text-blue-900 flex items-center gap-2">
              <Keyboard className="h-4 w-4" />
              One-Time Setup Instructions:
            </div>
            <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
              <li>Put your scanner in <strong>Bluetooth HID</strong> (keyboard) mode</li>
              <li>Configure suffix: <strong>Enter/CR</strong></li>
              <li>Optional: Add prefix like <strong>@@</strong> or <strong>]Q</strong></li>
              <li>Pair scanner in iOS Settings → Bluetooth</li>
              <li>Return to this app and click "Start Scanner"</li>
            </ol>
            <p className="text-xs text-blue-700 mt-2">
              ℹ️ Your scanner will appear as a keyboard. This works on <strong>all iOS devices</strong> (iPhone/iPad) and all browsers.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
