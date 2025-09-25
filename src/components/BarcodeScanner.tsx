import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  const digits = barcode.replace(/\D/g, '');
  
  switch (format) {
    case 'UPC_A':
      return digits.padStart(14, '0');
    case 'UPC_E':
      return digits.padStart(14, '0');
    case 'EAN_13':
      return digits.padStart(14, '0');
    case 'EAN_8':
      return digits.padStart(14, '0');
    default:
      return /^\d+$/.test(digits) ? digits.padStart(14, '0') : barcode;
  }
};

// Canvas pool for memory efficiency
class CanvasPool {
  private static pool: HTMLCanvasElement[] = [];
  private static maxSize = 2;

  static get(): HTMLCanvasElement {
    return this.pool.pop() || document.createElement('canvas');
  }

  static release(canvas: HTMLCanvasElement) {
    if (this.pool.length < this.maxSize) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }
      this.pool.push(canvas);
    }
  }

  static cleanup() {
    this.pool = [];
  }
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onError,
  className,
  autoStart = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const grokTimeoutRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [state, setState] = useState({
    isScanning: false,
    hasPermission: null as boolean | null,
    debugInfo: 'Ready to start',
    lastScan: '',
    scanCooldown: false,
    isPaused: false,
    isUsingGrokOCR: false,
    scanAttempts: 0
  });

  const frameSkipCounter = useRef(0);
  const lastScanTime = useRef(0);

  // Initialize reader once
  useEffect(() => {
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
    hints.set(DecodeHintType.PURE_BARCODE, false);

    readerRef.current = new BrowserMultiFormatReader(hints);

    return cleanup;
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (grokTimeoutRef.current) {
      clearTimeout(grokTimeoutRef.current);
      grokTimeoutRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    CanvasPool.cleanup();
  }, []);

  // Optimized Grok OCR with single canvas
  const attemptGrokOCR = useCallback(async (): Promise<boolean> => {
    if (!videoRef.current || state.isPaused) return false;

    setState(prev => ({ 
      ...prev, 
      isUsingGrokOCR: true, 
      debugInfo: 'Using AI to read barcode...' 
    }));

    try {
      const video = videoRef.current;
      const canvas = CanvasPool.get();
      const ctx = canvas.getContext('2d')!;

      canvas.width = Math.min(video.videoWidth, 800); // Limit size for performance
      canvas.height = Math.min(video.videoHeight, 600);
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.7); // Lower quality for speed
      
      CanvasPool.release(canvas);

      const response = await fetch('/functions/v1/grok-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: imageDataUrl })
      });

      if (!response.ok) throw new Error('OCR service failed');

      const result = await response.json();
      const barcodeMatches = result.text?.match(/\b\d{8,14}\b/g);
      
      if (barcodeMatches?.[0]) {
        const barcodeText = barcodeMatches[0];
        
        if (barcodeText !== state.lastScan && !state.scanCooldown) {
          const normalizedGtin = normalizeGtin(barcodeText, 'OCR');
          onScan(normalizedGtin, 'OCR');
          
          setState(prev => ({
            ...prev,
            lastScan: barcodeText,
            scanCooldown: true,
            isPaused: true,
            isUsingGrokOCR: false,
            debugInfo: `AI found barcode: ${barcodeText}`
          }));

          setTimeout(() => {
            setState(prev => ({
              ...prev,
              scanCooldown: false,
              debugInfo: 'Paused - click Resume to continue scanning'
            }));
          }, 1000);
        }
        return true;
      }
      
      setState(prev => ({ 
        ...prev, 
        isUsingGrokOCR: false, 
        debugInfo: 'AI could not find barcode' 
      }));
      return false;
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        isUsingGrokOCR: false, 
        debugInfo: 'AI barcode reading failed' 
      }));
      return false;
    }
  }, [state.isPaused, state.lastScan, state.scanCooldown, onScan]);

  // Handle successful barcode scan
  const handleScanSuccess = useCallback((result: any, format: string) => {
    // Clear Grok timeout on successful scan
    if (grokTimeoutRef.current) {
      clearTimeout(grokTimeoutRef.current);
      grokTimeoutRef.current = null;
    }

    if (result !== state.lastScan && !state.scanCooldown) {
      const normalizedGtin = normalizeGtin(result, format);
      onScan(normalizedGtin, format);
      
      setState(prev => ({
        ...prev,
        lastScan: result,
        scanCooldown: true,
        isPaused: true,
        debugInfo: `Found ${format}: ${result}`,
        scanAttempts: 0
      }));

      setTimeout(() => {
        setState(prev => ({
          ...prev,
          scanCooldown: false,
          debugInfo: 'Paused - click Resume to continue scanning'
        }));
      }, 1000);
    }
  }, [state.lastScan, state.scanCooldown, onScan]);

  // Handle scan errors
  const handleScanError = useCallback(() => {
    setState(prev => ({ ...prev, scanAttempts: prev.scanAttempts + 1 }));
  }, []);

  // Start scanning with optimization
  const startScanning = useCallback(async () => {
    setState(prev => ({ 
      ...prev, 
      isScanning: true, 
      debugInfo: 'Starting scanner...', 
      scanAttempts: 0 
    }));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280, max: 1920 }, // Limit max resolution
          height: { ideal: 720, max: 1080 }
        }
      });
      
      streamRef.current = stream;
      setState(prev => ({ 
        ...prev, 
        hasPermission: true, 
        debugInfo: 'Camera live - scanning...' 
      }));
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Start 2-second timeout for Grok OCR
      grokTimeoutRef.current = window.setTimeout(() => {
        if (!state.isPaused && !state.scanCooldown) {
          attemptGrokOCR();
        }
      }, 2000);

      // Start ZXing continuous scanning with callback
      if (readerRef.current && videoRef.current) {
        await readerRef.current.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, error) => {
            // Skip frames for performance - only process every 4th callback
            frameSkipCounter.current = (frameSkipCounter.current + 1) % 4;
            if (frameSkipCounter.current !== 0) return;

            // Don't process if paused
            if (state.isPaused) return;

            if (result) {
              handleScanSuccess(result.getText(), result.getBarcodeFormat().toString());
            } else if (error) {
              handleScanError();
            }
          }
        );
      }
      
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        debugInfo: `Error: ${error.message}`,
        hasPermission: false,
        isScanning: false
      }));
      onError?.(error.message);
    }
  }, [handleScanSuccess, handleScanError, attemptGrokOCR, state.isPaused, state.scanCooldown]);

  const resumeScanning = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      isPaused: false, 
      debugInfo: 'Resumed scanning...' 
    }));
    
    // Restart Grok timeout
    if (grokTimeoutRef.current) {
      clearTimeout(grokTimeoutRef.current);
    }
    grokTimeoutRef.current = window.setTimeout(() => {
      if (!state.isPaused && !state.scanCooldown) {
        attemptGrokOCR();
      }
    }, 2000);
  }, [attemptGrokOCR, state.isPaused, state.scanCooldown]);

  const stopScanning = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      isScanning: false, 
      debugInfo: 'Stopped' 
    }));
    cleanup();
  }, [cleanup]);

  const toggleScanning = useCallback(() => {
    if (state.isScanning) {
      stopScanning();
    } else {
      startScanning();
    }
  }, [state.isScanning, stopScanning, startScanning]);

  useEffect(() => {
    if (autoStart) {
      startScanning();
    }
  }, [autoStart, startScanning]);

  return (
    <Card className={cn('w-full max-w-md mx-auto', className)}>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center gap-2 justify-center">
          <Camera className="h-5 w-5" />
          Barcode Scanner
        </CardTitle>
        <CardDescription>
          High-performance scanner with AI fallback
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
          {state.isScanning ? (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-32 border-2 border-primary border-dashed rounded-lg bg-primary/10">
                  <Target className="w-full h-full text-primary/30" />
                </div>
              </div>
              {state.scanCooldown && (
                <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-sm">
                  Scanned! ✓
                </div>
              )}
              {state.isPaused && !state.scanCooldown && (
                <div className="absolute top-2 left-2 bg-orange-500 text-white px-2 py-1 rounded text-sm">
                  Paused
                </div>
              )}
              {state.isUsingGrokOCR && (
                <div className="absolute top-2 right-2 bg-purple-500 text-white px-2 py-1 rounded text-sm flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  AI Reading...
                </div>
              )}
              {state.scanAttempts > 10 && !state.isUsingGrokOCR && (
                <div className="absolute bottom-2 left-2 right-2 bg-yellow-500/90 text-white px-2 py-1 rounded text-xs text-center">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  Try different angle or lighting
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Target className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {state.hasPermission === false 
                    ? 'Camera access denied'
                    : 'Click start to begin scanning'
                  }
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button 
            onClick={toggleScanning}
            variant={state.isScanning ? "destructive" : "default"}
            className="flex-1"
          >
            {state.isScanning ? (
              <>
                <Square className="h-4 w-4 mr-2" />
                Stop
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                Start
              </>
            )}
          </Button>

          {state.isPaused && (
            <Button onClick={resumeScanning} variant="outline">
              Resume
            </Button>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center">
          {state.debugInfo}
        </div>
      </CardContent>
    </Card>
  );
};