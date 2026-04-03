import { useEffect, useRef, useState, useCallback } from 'react';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scan, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { processEAN13ToUPCA, shouldDeduplicateScan } from '@/utils/scannerConfig';

interface MLKitBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

const SUPPORTED_FORMATS = [
  BarcodeFormat.EanThirteen,
  BarcodeFormat.EanEight,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.QrCode,
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Itf,
  BarcodeFormat.Codabar,
];

export const MLKitBarcodeScanner = ({
  onScan,
  onError,
  className = '',
}: MLKitBarcodeScannerProps) => {
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error'>('initializing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);
  const listenerRef = useRef<{ remove: () => void } | null>(null);

  const handleBarcode = useCallback((value: string, format: string) => {
    const normalizedFormat = format.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    const processedValue = processEAN13ToUPCA(value, normalizedFormat);

    if (shouldDeduplicateScan(lastScanRef.current, processedValue)) {
      return;
    }

    lastScanRef.current = { value: processedValue, time: Date.now() };
    onScan(processedValue, normalizedFormat);
  }, [onScan]);

  useEffect(() => {
    let mounted = true;

    const startScanning = async () => {
      try {
        const permResult = await BarcodeScanner.requestPermissions();
        if (!mounted) return;

        if (permResult.camera !== 'granted') {
          setStatus('error');
          setErrorMessage('Camera permission denied');
          onError?.('Camera permission denied');
          return;
        }

        const listener = await BarcodeScanner.addListener('barcodeScanned', (result) => {
          const barcode = result.barcode;
          handleBarcode(barcode.rawValue, barcode.format);
        });
        listenerRef.current = listener;

        await BarcodeScanner.startScan({
          formats: SUPPORTED_FORMATS,
          lensFacing: 'BACK',
        });

        if (mounted) {
          setStatus('scanning');
        }
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : 'Scanner initialization failed';
        setStatus('error');
        setErrorMessage(msg);
        onError?.(msg);
      }
    };

    startScanning();

    return () => {
      mounted = false;
      listenerRef.current?.remove();
      BarcodeScanner.stopScan().catch(() => {});
      BarcodeScanner.removeAllListeners().catch(() => {});
    };
  }, [handleBarcode, onError]);

  if (status === 'error') {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-8 space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" size="sm" onClick={() => { setStatus('initializing'); setErrorMessage(''); }}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {status === 'initializing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Starting ML Kit scanner...</p>
          </CardContent>
        </Card>
      )}

      {status === 'scanning' && (
        <>
          <div className="flex justify-center">
            <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
              <Scan className="w-3 h-3 mr-1" />
              ML Kit Native Scanner
            </Badge>
          </div>
          <div
            className="relative rounded-lg overflow-hidden border border-border/40"
            style={{ width: '100%', aspectRatio: '4/3', backgroundColor: 'transparent' }}
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-2/3 h-1/3 border-2 border-primary/60 rounded-lg" />
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80 drop-shadow-md">
              Point camera at barcode
            </p>
          </div>
        </>
      )}
    </div>
  );
};
