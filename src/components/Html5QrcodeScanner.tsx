import { useEffect, useRef, useState, useCallback } from 'react';
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
  const [cameraId, setCameraId] = useState<string>('');
  const [availableCameras, setAvailableCameras] = useState<any[]>([]);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [iOSDebugMode, setIOSDebugMode] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);

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
          console.log('📷 Available cameras:', cameras.length, 'Selected:', backCamera?.label || cameras[0]?.label);
        } catch (cameraError) {
          console.warn('Camera enumeration failed:', cameraError);
          setScannerError('Camera access required for scanning');
        }

        if (autoStart) {
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
    setTorchOn(false);
    setScannerError(null);
  };

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
            const formatName = decodedResult.result.format.formatName;

            // Normalize the value first (e.g., EAN-13 → UPC-A) so dedupe compares apples-to-apples
            const processedValue = processEAN13ToUPCA(decodedText, formatName);
            if (processedValue !== decodedText) {
              console.log('🔄 Converted EAN-13 to UPC-A:', decodedText, '→', processedValue);
            }

            // Check if we should deduplicate this scan
            if (shouldDeduplicateScan(lastScanRef.current, processedValue, 1500)) {
              return; // Skip duplicate scan
            }

            console.log('✅ Barcode detected:', processedValue, formatName);

            // Update state
            const now = Date.now();
            lastScanRef.current = { value: processedValue, time: now };
            setLastScanned(processedValue);
            onScan(processedValue, formatName);

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
  const checkTorchSupport = useCallback(() => {
    try {
      const caps = scannerRef.current?.getRunningTrackCapabilities() as any;
      setTorchSupported(!!(caps?.torch));
    } catch (error) {
      setTorchSupported(false);
    }
  }, []);

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
                  Enhanced Scanner
                </Badge>
                {lastScanned && (
                  <Badge className="bg-gradient-to-r from-green-500 to-emerald-600 animate-in fade-in">
                    <Scan className="w-3 h-3 mr-1" />
                    Scanned: {lastScanned.slice(0, 8)}...
                  </Badge>
                )}
              </div>
              
              {/* Platform indicator */}
              <Badge variant="secondary" className="text-xs">
                {isIOSDevice() ? 'iOS Optimized' : 
                 /Android/.test(navigator.userAgent) ? 'Android Optimized' : 
                 'Desktop Mode'}
              </Badge>
            </div>
          )}

          {/* Enhanced scanning guidelines for iPhone */}
          {isScanning && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-center text-white bg-black/60 rounded-lg p-4 max-w-sm mx-4">
                <p className="text-sm mb-2 font-medium">
                  {isIOSDevice() ? '📱 iPhone Scanning Tips:' : 'Scanning Tips:'}
                </p>
                <ul className="text-xs space-y-1 text-left">
                  {isIOSDevice() ? (
                    <>
                      <li>• Hold iPhone steady with both hands</li>
                      <li>• Move closer/farther to focus</li>
                      <li>• Ensure good lighting (use flashlight if dark)</li>
                      <li>• Keep barcode flat and centered</li>
                      <li>• Clean camera lens if blurry</li>
                      <li>• Try rotating barcode 90° if not scanning</li>
                    </>
                  ) : (
                    <>
                      <li>• Hold steady, avoid shaking</li>
                      <li>• Ensure good lighting</li>
                      <li>• Keep barcode in center box</li>
                      <li>• Try different angles if needed</li>
                    </>
                  )}
                </ul>
                {isIOSDevice() && (
                  <p className="text-xs mt-2 opacity-80">
                    📈 Using iOS optimized scanner
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Enhanced Controls */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 z-10">
            {!isScanning ? (
              <Button onClick={startScanning} size="lg" aria-label="Start scanning">
                <Scan className="w-4 h-4 mr-2" />
                Start Enhanced Scanner
              </Button>
            ) : (
              <div className="flex gap-2">
                {/* Camera switch button */}
                {availableCameras.length > 1 && (
                  <Button onClick={switchCamera} variant="outline" size="lg" aria-label="Switch camera">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                )}
                
                {/* Torch button (Android Chrome mainly) */}
                {torchSupported && (
                  <Button 
                    onClick={toggleTorch} 
                    variant={torchOn ? "default" : "outline"} 
                    size="lg" 
                    aria-label={torchOn ? "Turn off torch" : "Turn on torch"}
                  >
                    {torchOn ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
                  </Button>
                )}
                
                {/* Stop button */}
                <Button onClick={stopScanning} variant="destructive" size="lg" aria-label="Stop scanning">
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
