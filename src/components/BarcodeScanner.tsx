import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Square, Loader2, Target, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

// Normalize common barcode formats to GTIN-14
const normalizeGtin = (barcode: string, format: string): string => {
  // Remove any non-digit characters
  const digits = barcode.replace(/\D/g, '');
  
  switch (format) {
    case 'UPC_A':
      // UPC-A is 12 digits, pad to 14 with leading zeros
      return digits.padStart(14, '0');
    case 'UPC_E':
      // UPC-E needs to be expanded to UPC-A first, then padded
      // This is a simplified version - full expansion rules are more complex
      return digits.padStart(14, '0');
    case 'EAN_13':
      // EAN-13 is 13 digits, pad to 14 with one leading zero
      return digits.padStart(14, '0');
    case 'EAN_8':
      // EAN-8 is 8 digits, pad to 14 with leading zeros
      return digits.padStart(14, '0');
    default:
      // For other formats, just return as-is or pad if numeric
      return /^\d+$/.test(digits) ? digits.padStart(14, '0') : barcode;
  }
};

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onError,
  className,
  autoStart = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanningIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('Ready to start');
  const [lastScan, setLastScan] = useState<string>('');
  const [scanCooldown, setScanCooldown] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [isProcessingCurved, setIsProcessingCurved] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const frameSkipCounter = useRef(0);

  useEffect(() => {
    // Initialize the reader with enhanced hints for curved surfaces
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.PURE_BARCODE, false); // Allow imperfect barcodes

    readerRef.current = new BrowserMultiFormatReader(hints);
    console.log('🔧 Enhanced ZXing reader initialized for curved surfaces');

    return () => {
      stopScanning();
      if (scanningIntervalRef.current) {
        clearInterval(scanningIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (autoStart) {
      startScanning();
    }
  }, [autoStart]);

  // Enhanced image preprocessing for curved surfaces
  const preprocessImage = (imageData: ImageData): ImageData => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    ctx.putImageData(imageData, 0, 0);
    
    // Apply contrast enhancement
    ctx.filter = 'contrast(150%) brightness(110%)';
    ctx.drawImage(canvas, 0, 0);
    
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  // Multi-frame scanning approach for curved surfaces
  const attemptMultiFrameScan = async (): Promise<boolean> => {
    if (!videoRef.current || !canvasRef.current || !readerRef.current) return false;

    setIsProcessingCurved(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const video = videoRef.current;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const frames = 5; // Try 5 different frames
    for (let i = 0; i < frames; i++) {
      try {
        // Wait a bit between frames
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Capture current frame
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Try different preprocessing approaches
        const variations = [
          imageData, // Original
          preprocessImage(imageData), // Enhanced contrast
        ];

        for (const variation of variations) {
          try {
            // Create a temporary canvas for this variation
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d')!;
            tempCtx.putImageData(variation, 0, 0);
            
            const result = await readerRef.current.decodeFromImageUrl(tempCanvas.toDataURL());
            if (result) {
              const barcodeText = result.getText();
              const format = result.getBarcodeFormat().toString();
              
              console.log('📱 Multi-frame scan success:', barcodeText, format);
              setDebugInfo(`Multi-frame found ${format}: ${barcodeText}`);
              
              if (barcodeText !== lastScan || !scanCooldown) {
                setLastScan(barcodeText);
                setScanCooldown(true);
                const normalizedGtin = normalizeGtin(barcodeText, format);
                onScan(normalizedGtin, format);
                
                setTimeout(() => {
                  setScanCooldown(false);
                  setDebugInfo('Camera live - scanning for barcodes...');
                }, 3000);
              }
              
              setIsProcessingCurved(false);
              return true;
            }
          } catch (e) {
            // Continue trying other variations
          }
        }
      } catch (e) {
        // Continue to next frame
      }
    }
    
    setIsProcessingCurved(false);
    return false;
  };

  const startScanning = async () => {
    console.log('🎯 startScanning called');
    setDebugInfo('Starting enhanced scanner...');
    setIsScanning(true);
    setScanAttempts(0);
    
    // Wait for elements to render
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!videoRef.current || !readerRef.current) {
      console.log('❌ Missing refs - video:', !!videoRef.current, 'reader:', !!readerRef.current);
      setDebugInfo('Error: Missing video element or reader');
      setIsScanning(false);
      return;
    }

    try {
      console.log('🟢 Requesting high-res camera...');
      setDebugInfo('Requesting camera access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 }
        }
      });
      
      console.log('✅ Camera access granted with enhanced settings');
      setDebugInfo('Camera live - enhanced curved surface scanning...');
      setHasPermission(true);
      
      let lastFailureTime = 0;
      const FAILURE_RETRY_INTERVAL = 5000; // 5 seconds
      
      // Start continuous decode with enhanced error handling
      await readerRef.current.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result, error) => {
          // Skip frames for performance - only process every 3rd frame
          frameSkipCounter.current = (frameSkipCounter.current + 1) % 3;
          if (frameSkipCounter.current !== 0) return;

          // Don't process if paused
          if (isPaused) return;

          if (result) {
            const barcodeText = result.getText();
            const format = result.getBarcodeFormat().toString();
            
            console.log('📱 Standard scan success:', barcodeText, format);
            setDebugInfo(`Found ${format}: ${barcodeText}`);
            setScanAttempts(0);
            
            if (barcodeText !== lastScan || !scanCooldown) {
              setLastScan(barcodeText);
              setScanCooldown(true);
              setIsPaused(true); // Pause scanning to prevent overwrites
              const normalizedGtin = normalizeGtin(barcodeText, format);
              onScan(normalizedGtin, format);
              
              setTimeout(() => {
                setScanCooldown(false);
                setDebugInfo('Paused - click Resume to continue scanning');
              }, 1000);
            }
          } else if (error && !isPaused) {
            // Increment scan attempts for fallback logic
            setScanAttempts(prev => prev + 1);
            
            // After several failed attempts, try multi-frame approach (less frequently)
            const now = Date.now();
            if (scanAttempts > 15 && (now - lastFailureTime) > FAILURE_RETRY_INTERVAL) {
              lastFailureTime = now;
              setDebugInfo('Trying enhanced curve detection...');
              
              const success = await attemptMultiFrameScan();
              if (!success) {
                setDebugInfo('Hold steady - scanning curved surface...');
              }
            }
          }
        }
      );
      
    } catch (error: any) {
      console.error('❌ Camera error:', error);
      setDebugInfo(`Error: ${error.message}`);
      setHasPermission(false);
      setIsScanning(false);
      onError?.(error.message);
    }
  };

  const resumeScanning = () => {
    setIsPaused(false);
    setDebugInfo('Resumed scanning...');
  };

  const stopScanning = () => {
    console.log('🛑 Stopping scanner');
    setDebugInfo('Stopping...');
    
    // Clean up scanning interval
    if (scanningIntervalRef.current) {
      clearInterval(scanningIntervalRef.current);
      scanningIntervalRef.current = null;
    }
    
    // Properly clean up video stream
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('📹 Stopped video track');
      });
      videoRef.current.srcObject = null;
    }
    
    setIsScanning(false);
    setDebugInfo('Stopped');
  };

  const toggleScanning = () => {
    console.log('🔄 toggleScanning called, isScanning:', isScanning);
    if (isScanning) {
      stopScanning();
    } else {
      startScanning();
    }
  };

  return (
    <Card className={cn('w-full max-w-md mx-auto', className)}>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center gap-2 justify-center">
          <Camera className="h-5 w-5" />
          Barcode Scanner
        </CardTitle>
        <CardDescription>
          Enhanced for curved surfaces - hold steady for best results
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
          {isScanning ? (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <canvas
                ref={canvasRef}
                className="hidden"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-32 border-2 border-primary border-dashed rounded-lg bg-primary/10">
                  <Target className="w-full h-full text-primary/30" />
                </div>
              </div>
              {scanCooldown && (
                <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-sm">
                  Scanned! ✓
                </div>
              )}
              {isPaused && !scanCooldown && (
                <div className="absolute top-2 left-2 bg-orange-500 text-white px-2 py-1 rounded text-sm">
                  Paused
                </div>
              )}
              {isProcessingCurved && (
                <div className="absolute top-2 right-2 bg-blue-500 text-white px-2 py-1 rounded text-sm flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Curve Detection
                </div>
              )}
              {scanAttempts > 5 && !isProcessingCurved && (
                <div className="absolute bottom-2 left-2 right-2 bg-yellow-500/90 text-white px-2 py-1 rounded text-xs text-center">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  Try flattening curved surfaces or adjusting angle
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Target className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {hasPermission === false
                    ? 'Camera access denied'
                    : 'Enhanced scanner ready - works on curved surfaces'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => {
              console.log('🔥 Button clicked!');
              toggleScanning();
            }}
            disabled={hasPermission === false}
            className="flex-1"
          >
            {isScanning ? (
              <>
                <Square className="h-4 w-4 mr-2" />
                Stop Scanning
              </>
            ) : (
              <>
                <Target className="h-4 w-4 mr-2" />
                Start Enhanced Scan
              </>
            )}
          </Button>
          
          {isScanning && isPaused && (
            <Button
              onClick={resumeScanning}
              variant="outline"
              size="sm"
            >
              Resume
            </Button>
          )}
        </div>

        {lastScan && (
          <div className="text-center p-2 bg-primary/10 rounded">
            <p className="text-sm text-muted-foreground">Last scan:</p>
            <p className="font-mono text-sm font-medium">{lastScan}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};