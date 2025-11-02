import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scan, X, Zap } from 'lucide-react';

// Type declaration for native BarcodeDetector API
declare global {
  interface Window {
    BarcodeDetector: any;
  }
}

interface NativeBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

export const NativeBarcodeScanner = ({
  onScan,
  onError,
  className = '',
  autoStart = false,
}: NativeBarcodeScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  // Initialize BarcodeDetector
  useEffect(() => {
    const initDetector = async () => {
      try {
        const formats = await (window as any).BarcodeDetector.getSupportedFormats();
        console.log('✅ Native BarcodeDetector supported formats:', formats);
        
        detectorRef.current = new (window as any).BarcodeDetector({
          formats: formats, // Use all supported formats
        });
      } catch (error) {
        console.error('Failed to initialize BarcodeDetector:', error);
        onError?.('Failed to initialize barcode detector');
      }
    };

    if ('BarcodeDetector' in window) {
      initDetector();
    } else {
      onError?.('Native barcode detection not supported');
    }

    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (autoStart) {
      startScanning();
    }
  }, [autoStart]);

  const cleanup = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
  };

  const startScanning = async () => {
    if (!detectorRef.current) {
      onError?.('Barcode detector not initialized');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsScanning(true);
        scanLoop();
      }
    } catch (error) {
      console.error('Camera access error:', error);
      onError?.('Camera access denied or unavailable');
    }
  };

  const scanLoop = async () => {
    if (!isScanning && !videoRef.current) return;

    try {
      const barcodes = await detectorRef.current!.detect(videoRef.current!);

      if (barcodes.length > 0) {
        const barcode = barcodes[0];
        const now = Date.now();

        // Cooldown: 2 seconds between same barcode scans
        if (
          !lastScanRef.current ||
          lastScanRef.current.value !== barcode.rawValue ||
          now - lastScanRef.current.time > 2000
        ) {
          // Convert EAN-13 with leading 0 back to UPC-A (match other scanners)
          let barcodeValue = barcode.rawValue;
          if (barcode.format === 'ean_13' && barcode.rawValue.startsWith('0')) {
            barcodeValue = barcode.rawValue.slice(1);
            console.log('🔄 Converted EAN-13 to UPC-A:', barcode.rawValue, '→', barcodeValue);
          }
          
          console.log('✅ Barcode detected:', barcodeValue, barcode.format);
          lastScanRef.current = { value: barcodeValue, time: now };
          setLastScanned(barcodeValue);

          onScan(barcodeValue, barcode.format);

          // Clear after 2 seconds
          setTimeout(() => setLastScanned(null), 2000);
        }
      }
    } catch (error) {
      console.error('Detection error:', error);
    }

    // Continue scanning
    animationFrameRef.current = requestAnimationFrame(scanLoop);
  };

  const stopScanning = () => {
    cleanup();
  };

  return (
    <Card className={`relative overflow-hidden ${className}`}>
      <CardContent className="p-0">
        <div className="relative">
          {/* Video feed */}
          <video
            ref={videoRef}
            className="w-full h-auto"
            playsInline
            muted
            style={{ maxHeight: '60vh' }}
          />

          {/* Scanning overlay */}
          {isScanning && (
            <>
              {/* Scanning reticle */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-64 border-2 border-primary rounded-lg relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                </div>
              </div>

              {/* Status badges */}
              <div className="absolute top-4 left-4 flex gap-2">
                <Badge className="bg-gradient-to-r from-primary to-accent">
                  <Zap className="w-3 h-3 mr-1" />
                  Native API
                </Badge>
                {lastScanned && (
                  <Badge className="bg-gradient-to-r from-green-500 to-emerald-600 animate-in fade-in">
                    <Scan className="w-3 h-3 mr-1" />
                    Scanned
                  </Badge>
                )}
              </div>
            </>
          )}

          {/* Controls */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4">
            {!isScanning ? (
              <Button onClick={startScanning} size="lg">
                <Scan className="w-4 h-4 mr-2" />
                Start Scanning
              </Button>
            ) : (
              <Button onClick={stopScanning} variant="destructive" size="lg">
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
