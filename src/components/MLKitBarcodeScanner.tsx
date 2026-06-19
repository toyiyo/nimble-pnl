import { useEffect, useRef, useState, useCallback } from 'react';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scan, AlertCircle, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { processEAN13ToUPCA, shouldDeduplicateScan } from '@/utils/scannerConfig';

interface MLKitBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  active?: boolean; // controlled scan enable/disable; defaults to true for backward compat
}

const SUPPORTED_FORMATS = [
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.QrCode,
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Itf,
  BarcodeFormat.Codabar,
];

export function MLKitBarcodeScanner({
  onScan,
  onError,
  className = '',
  active = true,
}: MLKitBarcodeScannerProps) {
  const [status, setStatus] = useState<'ready' | 'scanning' | 'error'>('ready');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);

  // Latest-ref pattern: always call the current onScan callback, even if it changes identity
  // between renders (eliminates stale-closure root cause).
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  // Track the previous active value so we only launch on a false→true edge.
  const prevActiveRef = useRef(false);

  const handleScan = useCallback(async () => {
    setStatus('scanning');
    try {
      const permResult = await BarcodeScanner.requestPermissions();
      if (permResult.camera !== 'granted') {
        setStatus('error');
        setErrorMessage('Camera permission denied');
        onError?.('Camera permission denied');
        return;
      }

      // Opens a full-screen native scanner — no WebView transparency needed
      const result = await BarcodeScanner.scan({
        formats: SUPPORTED_FORMATS,
      });

      setStatus('ready');

      if (result.barcodes.length > 0) {
        const barcode = result.barcodes[0];
        const normalizedFormat = barcode.format.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
        const processedValue = processEAN13ToUPCA(barcode.rawValue, normalizedFormat);

        if (!shouldDeduplicateScan(lastScanRef.current, processedValue)) {
          lastScanRef.current = { value: processedValue, time: Date.now() };
          setLastScanned(processedValue);
          // Use ref so the latest callback is always invoked, not the one captured at creation.
          onScanRef.current(processedValue, normalizedFormat);
        }
      }
      // After scan resolves (success or empty result), do NOT auto-relaunch.
      // The session re-arms us via an active false→true transition.
    } catch (err) {
      setStatus('ready');
      // User cancelled the scanner — not an error
      if (err instanceof Error && err.message.includes('cancel')) return;
      const msg = err instanceof Error ? err.message : 'Scanner failed';
      setErrorMessage(msg);
      setStatus('error');
      onError?.(msg);
    }
  }, [onError]);

  // Launch the native scanner only on a false→true transition of active.
  // This replaces the unconditional mount auto-start and closes all three root causes:
  //   1. scan() only fires while armed (active=true)
  //   2. no auto-relaunch after scan completes (session controls re-arm)
  //   3. stale-closure eliminated via onScanRef
  useEffect(() => {
    if (active && !prevActiveRef.current) {
      handleScan();
    }
    prevActiveRef.current = active;
  }, [active, handleScan]);

  if (status === 'error') {
    return (
      <Card className={`rounded-xl border border-border/40 bg-background ${className}`}>
        <CardContent className="flex flex-col items-center justify-center py-8 space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-[13px] text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" size="sm" onClick={handleScan}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`rounded-xl border border-border/40 bg-background ${className}`}>
      <CardContent className="flex flex-col items-center justify-center py-8 space-y-4">
        {status === 'scanning' ? (
          <>
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-[13px] text-muted-foreground">Native scanner open...</p>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground text-background">
                <Scan className="w-3 h-3 mr-1" />
                ML Kit Native Scanner
              </Badge>
            </div>
            {lastScanned && (
              <p className="text-[13px] text-muted-foreground">
                Last scanned: <span className="font-mono font-medium text-foreground">{lastScanned}</span>
              </p>
            )}
            <Button onClick={handleScan} className="gap-2">
              <Camera className="w-4 h-4" />
              Scan Barcode
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
