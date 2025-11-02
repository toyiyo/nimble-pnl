import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scan, X, Camera } from 'lucide-react';

interface Html5QrcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

export const Html5QrcodeScanner = ({
  onScan,
  onError,
  className = '',
  autoStart = false,
}: Html5QrcodeScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = useRef(`html5-qrcode-${Date.now()}`);
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  useEffect(() => {
    // Initialize scanner
    scannerRef.current = new Html5Qrcode(elementId.current, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128, 
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.AZTEC,
        Html5QrcodeSupportedFormats.PDF_417,
      ],
      verbose: false,
    });

    if (autoStart) {
      startScanning();
    }

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = async () => {
    if (scannerRef.current?.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
    }
    setIsScanning(false);
  };

  const startScanning = async () => {
    if (!scannerRef.current) return;

    try {
      await scannerRef.current.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText, decodedResult) => {
          const now = Date.now();

          // Cooldown: 2 seconds between same barcode scans
          if (
            !lastScanRef.current ||
            lastScanRef.current.value !== decodedText ||
            now - lastScanRef.current.time > 2000
          ) {
            console.log('✅ Barcode detected:', decodedText, decodedResult.result.format.formatName);
            lastScanRef.current = { value: decodedText, time: now };
            setLastScanned(decodedText);

            onScan(decodedText, decodedResult.result.format.formatName);

            // Clear after 2 seconds
            setTimeout(() => setLastScanned(null), 2000);
          }
        },
        (errorMessage) => {
          // Silent - normal scanning errors
        }
      );

      setIsScanning(true);
    } catch (error: any) {
      console.error('Failed to start scanner:', error);
      onError?.(`Camera error: ${error.message || 'Unable to access camera'}`);
    }
  };

  const stopScanning = async () => {
    await cleanup();
  };

  return (
    <Card className={`relative overflow-hidden ${className}`}>
      <CardContent className="p-0">
        <div className="relative">
          {/* Scanner container */}
          <div id={elementId.current} className="w-full" />

          {/* Status badges */}
          {isScanning && (
            <div className="absolute top-4 left-4 flex gap-2 z-10">
              <Badge className="bg-gradient-to-r from-blue-500 to-cyan-600">
                <Camera className="w-3 h-3 mr-1" />
                html5-qrcode
              </Badge>
              {lastScanned && (
                <Badge className="bg-gradient-to-r from-green-500 to-emerald-600 animate-in fade-in">
                  <Scan className="w-3 h-3 mr-1" />
                  Scanned
                </Badge>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 z-10">
            {!isScanning ? (
              <Button onClick={startScanning} size="lg" aria-label="Start scanning">
                <Scan className="w-4 h-4 mr-2" />
                Start Scanning
              </Button>
            ) : (
              <Button onClick={stopScanning} variant="destructive" size="lg" aria-label="Stop scanning">
                <X className="w-4 h-4 mr-2" />
                Stop
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
