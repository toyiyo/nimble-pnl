// Simplified Html5QrcodeScanner for iPhone 13 Testing

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

export const Html5QrcodeScannerSimple = ({
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
  const [scannerError, setScannerError] = useState<string | null>(null);

  useEffect(() => {
    // Simple initialization
    scannerRef.current = new Html5Qrcode(elementId.current, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128, 
        Html5QrcodeSupportedFormats.CODE_39,
      ],
      verbose: false,
    });

    if (autoStart) {
      startScanning();
    }

    return () => {
      cleanup();
    };
  }, [autoStart]);

  const cleanup = async () => {
    if (scannerRef.current?.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
    }
    setIsScanning(false);
    setScannerError(null);
  };

  const startScanning = async () => {
    if (!scannerRef.current) {
      setScannerError('Scanner not initialized');
      return;
    }

    try {
      setScannerError(null);
      
      // Detect iPhone
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      
      // Simple but effective iPhone optimizations
      const config = {
        fps: isIOS ? 20 : 10, // Higher FPS for iPhone
        qrbox: function(viewfinderWidth: number, viewfinderHeight: number) {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = isIOS 
            ? Math.min(minEdge * 0.8, 300) // Larger box for iPhone
            : Math.min(minEdge * 0.7, 250);
          return { width: qrboxSize, height: qrboxSize };
        },
        aspectRatio: isIOS ? 4/3 : 16/9, // iPhone cameras prefer 4:3
        disableFlip: isIOS, // iPhone doesn't need flipping
      };

      await scannerRef.current.start(
        { facingMode: 'environment' }, // Simple camera constraints
        config,
        (decodedText, decodedResult) => {
          const now = Date.now();

          // Prevent duplicate scans (1.5s cooldown)
          if (
            !lastScanRef.current ||
            lastScanRef.current.value !== decodedText ||
            now - lastScanRef.current.time > 1500
          ) {
            console.log('✅ Barcode detected:', decodedText, decodedResult.result.format.formatName);
            
            // EAN-13 to UPC-A conversion
            let processedValue = decodedText;
            if (decodedResult.result.format.formatName === 'EAN_13' && decodedText.startsWith('0')) {
              processedValue = decodedText.slice(1);
            }

            lastScanRef.current = { value: processedValue, time: now };
            setLastScanned(processedValue);
            onScan(processedValue, decodedResult.result.format.formatName);

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
      const errorMsg = error.message || 'Unable to access camera';
      setScannerError(errorMsg);
      onError?.(errorMsg);
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
          <div id={elementId.current} className="w-full min-h-[300px]" />

          {/* Error state */}
          {scannerError && !isScanning && (
            <div className="absolute inset-0 bg-background/95 flex items-center justify-center">
              <div className="text-center space-y-4 p-6">
                <div className="text-destructive text-lg font-medium">{scannerError}</div>
                <Button onClick={startScanning} variant="outline">
                  <Scan className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </div>
          )}

          {/* Status badges */}
          {isScanning && (
            <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
              <div className="flex gap-2">
                <Badge className="bg-gradient-to-r from-blue-500 to-cyan-600">
                  <Camera className="w-3 h-3 mr-1" />
                  {/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iPhone Optimized' : 'Scanner'}
                </Badge>
                {lastScanned && (
                  <Badge className="bg-gradient-to-r from-green-500 to-emerald-600 animate-in fade-in">
                    <Scan className="w-3 h-3 mr-1" />
                    Scanned
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* iPhone scanning tips */}
          {isScanning && /iPad|iPhone|iPod/.test(navigator.userAgent) && (
            <div className="absolute bottom-20 left-4 right-4 pointer-events-none">
              <div className="text-center text-white bg-black/60 rounded-lg p-3">
                <p className="text-xs">
                  📱 Hold steady • Move closer/farther to focus • Try good lighting
                </p>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 z-10">
            {!isScanning ? (
              <Button onClick={startScanning} size="lg" aria-label="Start scanning">
                <Scan className="w-4 h-4 mr-2" />
                Start Scanner
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