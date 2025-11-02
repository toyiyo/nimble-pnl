import { useEffect, useState } from 'react';
import { NativeBarcodeScanner } from './NativeBarcodeScanner';
import { Html5QrcodeScanner } from './Html5QrcodeScanner';
import { OCRBarcodeScanner } from './OCRBarcodeScanner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Camera, Brain } from 'lucide-react';

interface SmartBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

type ScannerType = 'native' | 'ocr' | 'fallback' | 'checking';

export const SmartBarcodeScanner = ({
  onScan,
  onError,
  className = '',
  autoStart = false,
}: SmartBarcodeScannerProps) => {
  const [scannerType, setScannerType] = useState<ScannerType>('checking');

  useEffect(() => {
    // Check if native BarcodeDetector is available
    const checkNativeSupport = async () => {
      try {
        if ('BarcodeDetector' in window) {
          // Verify it actually works
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          
          if (formats && formats.length > 0) {
            console.log('✅ Using Native BarcodeDetector API');
            setScannerType('native');
            return;
          }
        }
      } catch (error) {
        console.warn('Native BarcodeDetector check failed:', error);
      }

      // Check if mobile device (iOS/Android have poor html5-qrcode support)
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (isMobile) {
        console.log('ℹ️ Using OCR scanner for mobile');
        setScannerType('ocr');
      } else {
        console.log('ℹ️ Using html5-qrcode fallback');
        setScannerType('fallback');
      }
    };

    checkNativeSupport();
  }, []);

  if (scannerType === 'checking') {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Initializing scanner...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {/* Scanner type indicator */}
      <div className="flex justify-center">
        {scannerType === 'native' && (
          <Badge className="bg-gradient-to-r from-primary to-accent">
            <Sparkles className="w-3 h-3 mr-1" />
            Ultra-Fast Native Scanner
          </Badge>
        )}
        {scannerType === 'ocr' && (
          <Badge className="bg-gradient-to-r from-purple-500 to-pink-600">
            <Brain className="w-3 h-3 mr-1" />
            AI-Powered Scanner
          </Badge>
        )}
        {scannerType === 'fallback' && (
          <Badge variant="secondary">
            <Camera className="w-3 h-3 mr-1" />
            Standard Scanner
          </Badge>
        )}
      </div>

      {/* Render appropriate scanner */}
      {scannerType === 'native' && (
        <NativeBarcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
          autoStart={autoStart}
        />
      )}
      {scannerType === 'ocr' && (
        <OCRBarcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
        />
      )}
      {scannerType === 'fallback' && (
        <Html5QrcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
          autoStart={autoStart}
        />
      )}
    </div>
  );
};
