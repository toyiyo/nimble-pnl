import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scan, X, Camera, RotateCcw, Flashlight, FlashlightOff } from 'lucide-react';
import { 
  SCANNER_FORMATS, 
  shouldDeduplicateScan, 
  processEAN13ToUPCA,
  isIOSDevice 
} from '@/utils/scannerConfig';

/** Returns a stable platform label string without nested ternaries. */
function getPlatformLabel(): string {
  if (isIOSDevice()) return 'iOS Optimized';
  if (/Android/.test(navigator.userAgent)) return 'Android Optimized';
  return 'Desktop Mode';
}

interface Html5QrcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
  active?: boolean; // controlled scan enable/disable; defaults to true for backward compat
}

export const Html5QrcodeScanner = ({
  onScan,
  onError,
  className = '',
  autoStart = false,
  active = true,
}: Html5QrcodeScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = useRef(`html5-qrcode-${Date.now()}`);
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);

  // Synchronously-updated ref so the success callback always reads the latest active value.
  const activeRef = useRef(active);
  // Latest onScan handler via ref — prevents stale closure from holding the first render's callback.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // refreshed every render

  const [isScanning, setIsScanning] = useState(false);
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string>('');
  const [availableCameras, setAvailableCameras] = useState<any[]>([]);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  // Enhanced initialization with camera enumeration
  useEffect(() => {
    const initializeScanner = async () => {
      try {
        // Initialize scanner with all supported formats
        scannerRef.current = new Html5Qrcode(elementId.current, {
          formatsToSupport: [
            ...SCANNER_FORMATS,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.AZTEC,
            Html5QrcodeSupportedFormats.PDF_417,
          ],
          verbose: false,
        });

        // Enumerate available cameras
        try {
          const cameras = await Html5Qrcode.getCameras();
          setAvailableCameras(cameras);
          
          // Prefer back camera on mobile
          const backCamera = cameras.find(camera => 
            camera.label.toLowerCase().includes('back') || 
            camera.label.toLowerCase().includes('rear') ||
            camera.label.toLowerCase().includes('environment')
          );
          
          setCameraId(backCamera?.id || cameras[0]?.id || '');
        } catch (cameraError) {
          console.warn('Camera enumeration failed:', cameraError);
          setScannerError('Camera access required for scanning');
        }

        // `active` is the single source of truth for start/stop; `autoStart` is now a no-op
        // kept only for API backward-compat (it no longer calls startScanning() here).

        // Initialization-race fix: if active=true arrived before this async init completed,
        // the active effect would have returned early (scannerRef.current was null). Start now.
        if (activeRef.current) {
          startScanning();
        }
      } catch (error) {
        console.error('Scanner initialization failed:', error);
        setScannerError('Failed to initialize scanner');
      }
    };

    initializeScanner();

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
    setTorchOn(false);
    setScannerError(null);
  };

  // Snapshot the live video frame to a dataURL so we can freeze the display while paused.
  const snapshotFrame = (): string | null => {
    const video = document.getElementById(elementId.current)?.querySelector('video') as HTMLVideoElement | null;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    try { return canvas.toDataURL('image/jpeg', 0.6); } catch { return null; }
  };

  // Drive start/pause/resume from the `active` prop.
  // Mirrors activeRef synchronously so the success callback reads the correct value.
  useEffect(() => {
    activeRef.current = active;
    if (!scannerRef.current) return; // scanner not yet initialized
    if (active) {
      setFrozenFrame(null); // clear freeze backdrop
      if (!scannerRef.current.isScanning) {
        startScanning(); // re-acquire + resume
      }
    } else if (scannerRef.current.isScanning) {
      setFrozenFrame(snapshotFrame()); // freeze backdrop, then stop
      void cleanup();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Simplified iOS optimizations that work reliably
  const startScanning = async () => {
    if (!scannerRef.current) {
      setScannerError('Scanner not initialized');
      return;
    }

    setScannerError(null);
      
      // iOS/Mobile Detection
      const isIOS = isIOSDevice();
      const isAndroid = /Android/.test(navigator.userAgent);
      const isMobile = isIOS || isAndroid;
      
      // Simple iPhone optimizations that work reliably
      const config = {
        // Higher FPS for iPhone (but not too high to cause issues)
        fps: isIOS ? 20 : isMobile ? 15 : 10,
        
        // Larger scan box for iPhone
        qrbox: function(viewfinderWidth: number, viewfinderHeight: number) {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = isIOS 
            ? Math.min(minEdge * 0.8, 300) // 80% for iOS
            : Math.min(minEdge * 0.7, 250); // 70% for others
          return { width: qrboxSize, height: qrboxSize };
        },
        
        // Better aspect ratio for iPhone cameras
        aspectRatio: isIOS ? 4/3 : (isMobile ? 16/9 : 1.777777),
        
        // Disable flipping on iOS
        disableFlip: isIOS,
        
        // Remember camera choice
        rememberLastUsedCamera: true,
        
        // Torch support (mainly Android)
        showTorchButtonIfSupported: false, // We handle this ourselves
        showZoomSliderIfSupported: false,
      };

      // Simple camera constraints that work reliably
      const getCameraConstraints = () => {
        if (cameraId) {
          return { deviceId: { exact: cameraId } };
        }
        
        // Use environment camera (back camera)
        return { facingMode: 'environment' };
      };

      const cameraConstraints = getCameraConstraints();

      // Start scanner with simple error handling
      try {
        await scannerRef.current.start(
          cameraConstraints,
          config,
          (decodedText, decodedResult) => {
            // Guard: ignore scans fired after the scanner was paused (race between
            // the library's async frame decode and the active prop flip).
            if (!activeRef.current) return;

            const formatName = decodedResult.result.format.formatName;

            // Normalize the value first (e.g., EAN-13 → UPC-A) so dedupe compares apples-to-apples
            const processedValue = processEAN13ToUPCA(decodedText, formatName);

            // Check if we should deduplicate this scan
            if (shouldDeduplicateScan(lastScanRef.current, processedValue, 1500)) {
              return; // Skip duplicate scan
            }

            // Update state
            const now = Date.now();
            lastScanRef.current = { value: processedValue, time: now };
            setLastScanned(processedValue);
            // Use onScanRef so the current handler is always called (kills stale-closure bug).
            onScanRef.current(processedValue, formatName);

            // Clear visual indicator after 2 seconds
            setTimeout(() => setLastScanned(null), 2000);
          },
          (errorMessage) => {
            // Only log significant errors, not normal scanning noise
            if (!errorMessage.includes('No MultiFormat Readers') && 
                !errorMessage.includes('NotFoundException')) {
              console.warn('Scanner error:', errorMessage);
            }
          }
        );

        setIsScanning(true);
        
        // Check for torch support after starting
        setTimeout(() => {
          checkTorchSupport();
        }, 1000);

      } catch (error: any) {
        const errorMsg = error.message || error.toString();
        console.error('Failed to start scanner:', error);
        
        // User-friendly error messages
        let friendlyError = 'Unable to access camera';
        if (errorMsg.includes('Permission denied')) {
          friendlyError = isIOS 
            ? 'Camera permission denied. Please go to Settings > Safari > Camera and allow access, then refresh this page.'
            : 'Camera permission denied. Please allow camera access and try again.';
        } else if (errorMsg.includes('not found')) {
          friendlyError = 'No camera found. Please check your device has a camera.';
        } else if (errorMsg.includes('NotReadableError')) {
          friendlyError = isIOS 
            ? 'Camera is busy. Please close other camera apps, wait a moment, and try again.'
            : 'Camera is being used by another app. Please close other camera apps and try again.';
        }
        
        setScannerError(friendlyError);
        onError?.(friendlyError);
      }
  };

  // Camera switching
  const switchCamera = async () => {
    if (availableCameras.length < 2) return;
    
    const currentIndex = availableCameras.findIndex(cam => cam.id === cameraId);
    const nextIndex = (currentIndex + 1) % availableCameras.length;
    const nextCamera = availableCameras[nextIndex];
    
    if (isScanning) {
      await cleanup();
      setCameraId(nextCamera.id);
      setTimeout(startScanning, 500); // Small delay for cleanup
    } else {
      setCameraId(nextCamera.id);
    }
  };

  // Torch/flashlight control
  const checkTorchSupport = () => {
    try {
      const caps = scannerRef.current?.getRunningTrackCapabilities() as any;
      setTorchSupported(!!(caps?.torch));
    } catch {
      setTorchSupported(false);
    }
  };

  const toggleTorch = async () => {
    if (!torchSupported || !isScanning) return;

    try {
      await scannerRef.current?.applyVideoConstraints({
        torch: !torchOn
      } as any);
      // Only toggle state after successful constraint application
      setTorchOn(!torchOn);
    } catch (error) {
      console.log('Torch not supported on this device');
      setTorchSupported(false);
    }
  };

  return (
    <Card className={`relative overflow-hidden ${className}`}>
      <CardContent className="p-0">
        <div className="relative">
          {/* Scanner container */}
          <div id={elementId.current} className="w-full min-h-[300px]" />

          {/* Freeze-frame backdrop — shown while the session is paused (active=false).
              Displays the last captured video frame with a dim overlay so the user
              sees where the camera was pointing rather than a blank/black view. */}
          {frozenFrame && (
            <div className="absolute inset-0">
              <img src={frozenFrame} alt="" aria-hidden="true" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-background/90 backdrop-blur-sm" />
            </div>
          )}

          {/* Error state */}
          {scannerError && !isScanning && (
            <div className="absolute inset-0 bg-background/95 flex items-center justify-center">
              <div className="text-center space-y-4 p-6">
                <div className="text-[14px] font-medium text-destructive">{scannerError}</div>
                <Button
                  onClick={startScanning}
                  variant="outline"
                  className="h-9 px-4 rounded-lg text-[13px] font-medium border-border/40"
                >
                  <Scan className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </div>
          )}

          {/* Status badges — semantic tokens (M4) */}
          {isScanning && (
            <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
              <div className="flex gap-2">
                <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground text-background">
                  <Camera className="w-3 h-3 mr-1" />
                  Enhanced Scanner
                </Badge>
                {lastScanned && (
                  <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground text-background animate-in fade-in">
                    <Scan className="w-3 h-3 mr-1" />
                    Scanned
                  </Badge>
                )}
              </div>

              {/* Platform indicator */}
              <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                {getPlatformLabel()}
              </Badge>
            </div>
          )}

          {/* Scanning guidelines */}
          {isScanning && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-center text-background bg-foreground/80 rounded-xl p-4 max-w-sm mx-4">
                <p className="text-[13px] mb-2 font-medium">
                  {isIOSDevice() ? 'iPhone Scanning Tips:' : 'Scanning Tips:'}
                </p>
                <ul className="text-[12px] space-y-1 text-left">
                  {isIOSDevice() ? (
                    <>
                      <li>Hold iPhone steady with both hands</li>
                      <li>Move closer/farther to focus</li>
                      <li>Ensure good lighting</li>
                      <li>Keep barcode flat and centered</li>
                      <li>Clean camera lens if blurry</li>
                      <li>Try rotating barcode 90° if not scanning</li>
                    </>
                  ) : (
                    <>
                      <li>Hold steady, avoid shaking</li>
                      <li>Ensure good lighting</li>
                      <li>Keep barcode in center box</li>
                      <li>Try different angles if needed</li>
                    </>
                  )}
                </ul>
                {isIOSDevice() && (
                  <p className="text-[12px] mt-2 opacity-80">
                    Using iOS optimized scanner
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Enhanced Controls */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 z-10">
            {!isScanning ? (
              <Button
                onClick={startScanning}
                aria-label="Start scanning"
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                <Scan className="w-4 h-4 mr-2" />
                Start Enhanced Scanner
              </Button>
            ) : (
              <div className="flex gap-2">
                {/* Camera switch button */}
                {availableCameras.length > 1 && (
                  <Button
                    onClick={switchCamera}
                    variant="ghost"
                    aria-label="Switch camera"
                    className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground bg-background/80 backdrop-blur-sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                )}

                {/* Torch button (Android Chrome mainly) */}
                {torchSupported && (
                  <Button
                    onClick={toggleTorch}
                    variant="ghost"
                    aria-label={torchOn ? "Turn off torch" : "Turn on torch"}
                    className={`h-9 px-3 rounded-lg text-[13px] font-medium bg-background/80 backdrop-blur-sm transition-colors ${
                      torchOn ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {torchOn ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
                  </Button>
                )}

                {/* Stop button */}
                <Button
                  onClick={cleanup}
                  variant="ghost"
                  aria-label="Stop scanning"
                  className="h-9 px-4 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80 bg-background/80 backdrop-blur-sm"
                >
                  <X className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
