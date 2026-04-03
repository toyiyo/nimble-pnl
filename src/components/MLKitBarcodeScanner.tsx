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

const TRANSPARENT_CLASS = 'mlkit-scanning';

/**
 * Makes the entire WebView transparent so the native camera preview
 * (rendered behind the WebView by ML Kit) is visible.
 * Uses a CSS class that sets all backgrounds to transparent via !important.
 */
function setWebViewTransparent(transparent: boolean) {
  if (transparent) {
    // Inject style tag if not already present
    if (!document.getElementById('mlkit-transparent-style')) {
      const style = document.createElement('style');
      style.id = 'mlkit-transparent-style';
      style.textContent = `
        .${TRANSPARENT_CLASS},
        .${TRANSPARENT_CLASS} body,
        .${TRANSPARENT_CLASS} #root,
        .${TRANSPARENT_CLASS} #root > * {
          background: transparent !important;
        }
      `;
      document.head.appendChild(style);
    }
    document.documentElement.classList.add(TRANSPARENT_CLASS);
  } else {
    document.documentElement.classList.remove(TRANSPARENT_CLASS);
  }
}

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

        // Make WebView transparent so native camera preview shows through
        setWebViewTransparent(true);

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
        setWebViewTransparent(false);
        const msg = err instanceof Error ? err.message : 'Scanner initialization failed';
        setStatus('error');
        setErrorMessage(msg);
        onError?.(msg);
      }
    };

    startScanning();

    return () => {
      mounted = false;
      setWebViewTransparent(false);
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
        <div
          className="fixed inset-0 z-50"
          style={{ backgroundColor: 'transparent' }}
        >
          {/* Scanning reticle — camera renders natively behind the entire WebView */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-2/3 h-1/3 border-2 border-white/60 rounded-xl shadow-lg" />
          </div>

          {/* Top bar */}
          <div className="absolute top-12 left-0 right-0 flex justify-center">
            <Badge className="bg-black/50 text-white border-0">
              <Scan className="w-3 h-3 mr-1" />
              Point camera at barcode
            </Badge>
          </div>

          {/* Close button */}
          <button
            onClick={() => {
              setWebViewTransparent(false);
              BarcodeScanner.stopScan().catch(() => {});
              listenerRef.current?.remove();
              BarcodeScanner.removeAllListeners().catch(() => {});
              setStatus('error');
              setErrorMessage('Scanner closed');
            }}
            className="absolute top-12 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center z-50"
            aria-label="Close scanner"
          >
            <span className="text-white text-lg">&times;</span>
          </button>

          {/* Bottom hint */}
          <p className="absolute bottom-24 left-0 right-0 text-center text-sm text-white/90 drop-shadow-md">
            Scanner is active
          </p>
        </div>
      )}
    </div>
  );
};
