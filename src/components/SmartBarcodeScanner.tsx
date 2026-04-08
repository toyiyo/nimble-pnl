import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { MLKitBarcodeScanner } from './MLKitBarcodeScanner';
import { NativeBarcodeScanner } from './NativeBarcodeScanner';
import { Html5QrcodeScanner } from './Html5QrcodeScanner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Camera } from 'lucide-react';

interface SmartBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

type ScannerType = 'mlkit' | 'native' | 'fallback' | 'checking';

function detectInitialScannerType(): ScannerType {
  if (Capacitor.isNativePlatform()) return 'mlkit';
  return 'checking';
}

export function SmartBarcodeScanner({
  onScan,
  onError,
  className = '',
  autoStart = false,
}: SmartBarcodeScannerProps) {
  const [scannerType, setScannerType] = useState<ScannerType>(detectInitialScannerType);

  useEffect(() => {
    if (scannerType !== 'checking') return;

    async function checkNativeSupport() {
      const userAgent = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(userAgent);
      const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
      const isFirefox = /Firefox/.test(userAgent);

      if (isIOS || isSafari || isFirefox) {
        setScannerType('fallback');
        return;
      }

      try {
        if ('BarcodeDetector' in window) {
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          if (formats && formats.length > 0) {
            setScannerType('native');
            return;
          }
        }
      } catch {
        // BarcodeDetector not available
      }

      setScannerType('fallback');
    }

    checkNativeSupport();
  }, [scannerType]);

  if (scannerType === 'mlkit') {
    return (
      <div className="space-y-2">
        <div className="flex justify-center">
          <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground text-background">
            <Sparkles className="w-3 h-3 mr-1" />
            ML Kit Native Scanner
          </Badge>
        </div>
        <MLKitBarcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
        />
      </div>
    );
  }

  if (scannerType === 'checking') {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-[13px] text-muted-foreground">Initializing scanner...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-center">
        {scannerType === 'native' ? (
          <Badge className="bg-gradient-to-r from-primary to-accent">
            <Sparkles className="w-3 h-3 mr-1" />
            Native Scanner
          </Badge>
        ) : (
          <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
            <Camera className="w-3 h-3 mr-1" />
            HTML5 Scanner
          </Badge>
        )}
      </div>

      {scannerType === 'native' ? (
        <NativeBarcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
          autoStart={autoStart}
        />
      ) : (
        <Html5QrcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
          autoStart={autoStart}
        />
      )}
    </div>
  );
}
