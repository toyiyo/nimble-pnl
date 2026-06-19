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
  active?: boolean; // controlled scan enable/disable; defaults to true for backward compat
}

export const NativeBarcodeScanner = ({
  onScan,
  onError,
  className = '',
  autoStart = false,
  active = true,
}: NativeBarcodeScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const isDetectorReady = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);

  // Synchronously-updated ref so the rAF loop always reads the latest active value
  // without depending on React's async state update cycle (kills the stale-closure root cause).
  const activeRef = useRef(active);
  // Latest onScan handler via ref — prevents stale closure from holding the first render's callback.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // refreshed every render

  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  // Initialize BarcodeDetector
  useEffect(() => {
    const initDetector = async () => {
      try {
        // BarcodeDetector is a draft API not yet in TS lib — cast is required
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const formats = await (window as any /* BarcodeDetector not in TS lib */).BarcodeDetector.getSupportedFormats();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detectorRef.current = new (window as any /* BarcodeDetector not in TS lib */).BarcodeDetector({ formats });
        isDetectorReady.current = true;
        // Initialization-race fix: if active=true arrived before init completed,
        // the active effect would have found isDetectorReady=false and done nothing.
        // Start now that the detector is ready.
        if (activeRef.current && !streamRef.current) {
          startScanning();
        }
      } catch (error) {
        console.error('Failed to initialize BarcodeDetector:', error);
        isDetectorReady.current = false;
        onError?.('Failed to initialize barcode detector');
      }
    };

    if ('BarcodeDetector' in window) {
      initDetector();
    } else {
      isDetectorReady.current = false;
      onError?.('Native barcode detection not supported');
    }

    return () => {
      cleanup();
    };
  }, []);

  // Drive start/pause/resume from the `active` prop.
  // Mirrors activeRef synchronously so the rAF loop reads the correct value
  // even if it fires between the prop change and the next React render.
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      if (!streamRef.current && isDetectorReady.current) {
        // First start: acquire the camera stream, set isScanning, kick scanLoop
        startScanning();
      } else if (streamRef.current && videoRef.current) {
        // Resume: unfreeze the last frame and reschedule the loop
        videoRef.current.play().catch(() => {});
        if (animationFrameRef.current === null) {
          animationFrameRef.current = requestAnimationFrame(scanLoop);
        }
      }
    } else {
      // Pause: cancel the pending frame and freeze the last camera frame behind the overlay
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      videoRef.current?.pause();
    }
  }, [active]);

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
        // Only start the loop if still active (guard against a race where active became
        // false between the async camera acquisition and this callback).
        if (activeRef.current) {
          scanLoop();
        }
      }
    } catch (error) {
      console.error('Camera access error:', error);
      onError?.('Camera access denied or unavailable');
    }
  };

  const scanLoop = async () => {
    // Guard: exit and clear the frame ref if paused or video is gone.
    if (!activeRef.current || !videoRef.current) {
      animationFrameRef.current = null;
      return;
    }

    try {
      const barcodes = await detectorRef.current!.detect(videoRef.current!);

      // Re-check activeRef after the await: the prop may have flipped while detect() ran.
      if (barcodes.length > 0 && activeRef.current) {
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
          }
          lastScanRef.current = { value: barcodeValue, time: now };
          setLastScanned(barcodeValue);

          // Use onScanRef so the current handler is called, not the stale closure from mount.
          onScanRef.current(barcodeValue, barcode.format);

          // Clear after 2 seconds
          setTimeout(() => setLastScanned(null), 2000);
        }
      }
    } catch (error) {
      console.error('Detection error:', error);
    }

    // Re-schedule only if still active; otherwise exit cleanly.
    animationFrameRef.current = activeRef.current ? requestAnimationFrame(scanLoop) : null;
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
                <div className="w-[65%] aspect-square border-2 border-primary rounded-lg relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                </div>
              </div>

              {/* Status badges — semantic tokens (no hard-coded gradients) */}
              <div className="absolute top-4 left-4 flex gap-2">
                <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground text-background">
                  <Zap className="w-3 h-3 mr-1" />
                  Native API
                </Badge>
                {lastScanned && (
                  <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground text-background animate-in fade-in">
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
              <Button onClick={cleanup} variant="destructive" size="lg">
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
