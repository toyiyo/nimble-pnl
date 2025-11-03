import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scan, X, Camera, RotateCcw, Flashlight, FlashlightOff } from 'lucide-react';

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

  // Enhanced scanning with iOS optimizations
  const startScanning = async () => {
    if (!scannerRef.current) {
      setScannerError('Scanner not initialized');
      return;
    }

    try {
      setScannerError(null);
      
      // Enhanced iOS/Mobile Detection
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroid = /Android/.test(navigator.userAgent);
      const isMobile = isIOS || isAndroid;
      
      // iPhone-specific optimizations for better barcode scanning
      const getIOSOptimizedConfig = () => {
        if (!isIOS) return {};
        
        // iPhone models have different camera capabilities
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const isOlderIPhone = screenWidth <= 375; // iPhone 6/7/8/SE
        const isProModel = screenWidth >= 428; // iPhone Pro models
        
        return {
          // Higher FPS for better motion handling
          fps: isProModel ? 30 : isOlderIPhone ? 15 : 25,
          
          // More aggressive qrbox sizing for iOS
          qrbox: function(viewfinderWidth: number, viewfinderHeight: number) {
            // Use larger percentage of screen on iOS for better detection
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            let qrboxSize;
            
            if (isOlderIPhone) {
              // Smaller devices need larger relative scan area
              qrboxSize = Math.min(minEdge * 0.9, 320);
            } else if (isProModel) {
              // Pro models can handle larger absolute sizes
              qrboxSize = Math.min(minEdge * 0.75, 350);
            } else {
              // Standard iPhone models
              qrboxSize = Math.min(minEdge * 0.85, 300);
            }
            
            return {
              width: qrboxSize,
              height: qrboxSize,
            };
          },
          
          // iOS Safari works best with 4:3 aspect ratio
          aspectRatio: 4/3,
          
          // Disable image flipping - iOS handles orientation correctly
          disableFlip: true,
          
          // Enhanced video constraints for iOS
          videoConstraints: {
            facingMode: 'environment',
            
            // Try multiple resolution fallbacks for better iOS compatibility
            width: isProModel 
              ? { ideal: 1920, min: 1280, max: 2048 }
              : { ideal: 1280, min: 720, max: 1920 },
              
            height: isProModel
              ? { ideal: 1440, min: 960, max: 1536 }
              : { ideal: 960, min: 540, max: 1440 },
            
            // iOS cameras can handle higher frame rates
            frameRate: { 
              ideal: isProModel ? 30 : 25, 
              min: 15, 
              max: 60 
            },
            
            // iOS-specific advanced constraints
            ...(window.MediaStreamTrack && {
              advanced: [
                // Prefer autofocus for barcode scanning
                { focusMode: 'continuous' },
                { focusDistance: { ideal: 0.5 } }, // Mid-range focus
                
                // Enhanced exposure for better barcode reading
                { exposureMode: 'manual' },
                { exposureCompensation: { ideal: 0 } },
                
                // Better white balance for various lighting
                { whiteBalanceMode: 'auto' },
                
                // Noise reduction for cleaner image processing
                { noiseSuppression: true },
              ]
            })
          },
          
          // iOS-specific html5-qrcode library settings
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: false, // Force html5-qrcode processing
          },
          
          // Enhanced format support prioritization for iOS
          formatsToSupport: [
            // Prioritize common retail formats
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.CODE_93,
          ]
        };
      };
      
      // Get platform-optimized configuration
      const iosConfig = getIOSOptimizedConfig();
      
      const config = {
        // Base configuration
        fps: isIOS ? iosConfig.fps : isMobile ? 15 : 10,
        qrbox: iosConfig.qrbox || function(viewfinderWidth: number, viewfinderHeight: number) {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = Math.min(minEdge * 0.7, 250);
          return { width: qrboxSize, height: qrboxSize };
        },
        aspectRatio: iosConfig.aspectRatio || (isMobile ? 16/9 : 1.777777),
        disableFlip: iosConfig.disableFlip || false,
        
        // Enhanced rememberLastUsedCamera for iOS
        rememberLastUsedCamera: isIOS,
        
        // iOS works better with these settings
        showTorchButtonIfSupported: isAndroid, // Torch mainly works on Android
        showZoomSliderIfSupported: false, // Can cause issues on iOS
        
        // Additional iOS optimizations
        ...(isIOS && {
          useBarCodeDetectorIfSupported: false, // Force html5-qrcode processing
          verbose: false, // Reduce console noise
        })
      };

      // Enhanced camera constraints for iOS
      const getCameraConstraints = () => {
        if (cameraId) {
          return {
            deviceId: { exact: cameraId },
            ...(isIOS && iosConfig.videoConstraints)
          };
        }
        
        // iOS-optimized camera selection
        if (isIOS) {
          return {
            facingMode: { exact: 'environment' },
            ...iosConfig.videoConstraints
          };
        }
        
        // Standard constraints for other platforms
        return { facingMode: 'environment' };
      };

      const cameraConstraints = getCameraConstraints();

      // Enhanced error handling and retry logic for iOS
      let startAttempts = 0;
      const maxAttempts = isIOS ? 3 : 1; // iOS might need multiple attempts
      
      const attemptStart = async (): Promise<void> => {
        startAttempts++;
        
        try {
          await scannerRef.current!.start(
            cameraConstraints,
            config,
            (decodedText, decodedResult) => {
              const now = Date.now();

              // iOS-optimized duplicate detection (shorter cooldown for better UX)
              const cooldownTime = isIOS ? 1000 : 1500; // 1s on iOS, 1.5s elsewhere
              
              if (
                !lastScanRef.current ||
                lastScanRef.current.value !== decodedText ||
                now - lastScanRef.current.time > cooldownTime
              ) {
                console.log('✅ Barcode detected:', decodedText, decodedResult.result.format.formatName);
                
                // Enhanced barcode processing for iOS compatibility
                let processedValue = decodedText;
                const format = decodedResult.result.format.formatName;
                
                // EAN-13 to UPC-A conversion (match native scanner behavior)
                if (format === 'EAN_13' && decodedText.startsWith('0') && decodedText.length === 13) {
                  processedValue = decodedText.slice(1);
                  console.log('🔄 Converted EAN-13 to UPC-A:', decodedText, '→', processedValue);
                }
                
                // Clean up any whitespace or invalid characters (iOS Safari sometimes adds them)
                processedValue = processedValue.trim().replace(/[^\w\-]/g, '');
                
                // Validate barcode length for common formats
                const isValidBarcode = (
                  (format === 'UPC_A' && processedValue.length === 12) ||
                  (format === 'EAN_13' && processedValue.length === 13) ||
                  (format === 'EAN_8' && processedValue.length === 8) ||
                  (format === 'UPC_E' && processedValue.length === 8) ||
                  processedValue.length >= 4 // Allow other formats with minimum length
                );
                
                if (isValidBarcode) {
                  lastScanRef.current = { value: processedValue, time: now };
                  setLastScanned(processedValue);

                  onScan(processedValue, format);

                  // Shorter visual feedback on iOS for better responsiveness
                  setTimeout(() => setLastScanned(null), isIOS ? 1500 : 2000);
                } else {
                  console.warn('🚫 Invalid barcode format detected:', processedValue, 'format:', format);
                }
              }
            },
            (errorMessage) => {
              // iOS-specific error filtering (Safari produces more noise)
              const ignoredErrors = [
                'No MultiFormat Readers',
                'NotFoundException',
                'No code detected',
                'Unable to detect code',
                'NotFoundError'
              ];
              
              const shouldLog = !ignoredErrors.some(err => errorMessage.includes(err));
              
              if (shouldLog) {
                console.warn('📱 iOS Scanner error:', errorMessage);
              }
            }
          );

          setIsScanning(true);
          
          // iOS-specific post-start optimizations
          if (isIOS) {
            // Give iOS Safari more time to stabilize camera
            setTimeout(() => {
              checkTorchSupport();
              // Force a slight video element refresh for iOS
              const videoElement = document.querySelector(`#${elementId.current} video`);
              if (videoElement) {
                (videoElement as HTMLVideoElement).play().catch(() => {
                  console.log('iOS video element refresh attempted');
                });
              }
            }, 1500);
          } else {
            setTimeout(() => {
              checkTorchSupport();
            }, 1000);
          }
        } catch (error: any) {
          console.error(`📱 Start attempt ${startAttempts}/${maxAttempts} failed:`, error);
          
          // iOS-specific retry logic
          if (isIOS && startAttempts < maxAttempts) {
            console.log(`🔄 Retrying iOS camera start (${startAttempts + 1}/${maxAttempts})...`);
            
            // Wait before retry, with exponential backoff
            const delay = startAttempts * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Try with fallback constraints on retry
            if (startAttempts === 2) {
              console.log('📱 Trying iOS fallback constraints...');
              Object.assign(cameraConstraints, {
                facingMode: 'environment', // Remove 'exact'
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 15 }
              });
            }
            
            return attemptStart();
          }
          
          throw error;
        }
      };
      
      try {
        await attemptStart();
      } catch (error: any) {
        const errorMsg = error.message || error.toString();
        console.error('❌ All start attempts failed:', error);
        
        // Enhanced iOS-specific error messages
        let friendlyError = 'Unable to access camera';
        
        if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
          friendlyError = isIOS 
            ? 'Camera permission denied. Please go to Settings > Safari > Camera and allow access, then refresh this page.'
            : 'Camera permission denied. Please allow camera access and try again.';
        } else if (errorMsg.includes('not found') || errorMsg.includes('NotFoundError')) {
          friendlyError = 'No camera found. Please check your device has a working camera.';
        } else if (errorMsg.includes('NotReadableError') || errorMsg.includes('TrackStartError')) {
          friendlyError = isIOS 
            ? 'Camera is busy. Please close other camera apps, wait a moment, and try again.'
            : 'Camera is being used by another app. Please close other camera apps and try again.';
        } else if (errorMsg.includes('OverconstrainedError') || errorMsg.includes('ConstraintNotSatisfiedError')) {
          friendlyError = isIOS
            ? 'Camera settings not supported. This may happen on older iOS devices - try updating iOS or using a different device.'
            : 'Camera configuration not supported by your device.';
        } else if (isIOS && errorMsg.includes('AbortError')) {
          friendlyError = 'Camera initialization was interrupted. Please try again.';
        }
        
        setScannerError(friendlyError);
        onError?.(friendlyError);
      }    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      console.error('Failed to start scanner:', error);
      
      // User-friendly error messages
      let friendlyError = 'Unable to access camera';
      if (errorMsg.includes('Permission denied')) {
        friendlyError = 'Camera permission denied. Please allow camera access and try again.';
      } else if (errorMsg.includes('not found')) {
        friendlyError = 'No camera found. Please check your device has a camera.';
      } else if (errorMsg.includes('NotReadableError')) {
        friendlyError = 'Camera is being used by another app. Please close other camera apps and try again.';
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
      // Check if torch is supported (Chrome on Android mainly)
      if (scannerRef.current && 'applyVideoConstraints' in scannerRef.current) {
        setTorchSupported(true);
      }
    } catch (error) {
      setTorchSupported(false);
    }
  }, []);

  const toggleTorch = async () => {
    if (!torchSupported || !isScanning) return;

    try {
      const stream = scannerRef.current?.getRunningTrackSettings();
      if (stream && 'torch' in stream) {
        // This is experimental and only works on some Android Chrome versions
        const videoTrack = stream.getVideoTracks?.()?.[0];
        if (videoTrack) {
          await videoTrack.applyConstraints({
            advanced: [{ torch: !torchOn }]
          });
          setTorchOn(!torchOn);
        }
      }
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
                {/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iOS Optimized' : 
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
                  {/iPad|iPhone|iPod/.test(navigator.userAgent) ? '📱 iPhone Scanning Tips:' : 'Scanning Tips:'}
                </p>
                <ul className="text-xs space-y-1 text-left">
                  {/iPad|iPhone|iPod/.test(navigator.userAgent) ? (
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
                {/iPad|iPhone|iPod/.test(navigator.userAgent) && (
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
