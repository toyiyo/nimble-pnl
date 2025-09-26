import React, { useEffect, useRef, useReducer, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Square, Loader2, Target, AlertCircle, Zap, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from "@/integrations/supabase/client";

interface BarcodeScannerProps {
  onScan: (result: string, format: string, aiData?: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

// Scanner state management
interface ScannerState {
  isScanning: boolean;
  hasPermission: boolean | null;
  debugInfo: string;
  lastScan: string;
  scanCooldown: boolean;
  isPaused: boolean;
  isUsingGrokOCR: boolean;
  aiScanCount: number;
  lastAIResult: string | null;
}

type ScannerAction = 
  | { type: 'START_SCANNING' }
  | { type: 'STOP_SCANNING' }
  | { type: 'SET_PERMISSION'; payload: boolean }
  | { type: 'SET_DEBUG_INFO'; payload: string }
  | { type: 'SCAN_SUCCESS'; payload: { result: string; format: string } }
  | { type: 'SCAN_ERROR' }
  | { type: 'SET_COOLDOWN'; payload: boolean }
  | { type: 'SET_PAUSED'; payload: boolean }
  | { type: 'SET_GROK_OCR'; payload: boolean }
  | { type: 'INCREMENT_AI_SCAN' }
  | { type: 'SET_AI_RESULT'; payload: string | null };

const initialState: ScannerState = {
  isScanning: false, 
  hasPermission: null,
  debugInfo: 'Ready to start',
  lastScan: '',
  scanCooldown: false,
  isPaused: false,
  isUsingGrokOCR: false,
  aiScanCount: 0,
  lastAIResult: null
};

const scannerReducer = (state: ScannerState, action: ScannerAction): ScannerState => {
  switch (action.type) {
    case 'START_SCANNING':
      return { ...state, isScanning: true, debugInfo: 'Starting scanner...', aiScanCount: 0, lastAIResult: null };
    case 'STOP_SCANNING':
      return { ...state, isScanning: false, debugInfo: 'Stopped', isUsingGrokOCR: false, aiScanCount: 0, lastAIResult: null };
    case 'SET_PERMISSION':
      return { ...state, hasPermission: action.payload };
    case 'SET_DEBUG_INFO':
      return { ...state, debugInfo: action.payload };
    case 'SCAN_SUCCESS':
      return { 
        ...state, 
        lastScan: action.payload.result,
        scanCooldown: true,
        isPaused: true,
        debugInfo: `Found ${action.payload.format}: ${action.payload.result}`
      };
    case 'SCAN_ERROR':
      return state;
    case 'SET_COOLDOWN':
      return { ...state, scanCooldown: action.payload };
    case 'SET_PAUSED':
      return { ...state, isPaused: action.payload };
    case 'SET_GROK_OCR':
      return { ...state, isUsingGrokOCR: action.payload, aiScanCount: action.payload ? 0 : state.aiScanCount, lastAIResult: action.payload ? null : state.lastAIResult };
    case 'INCREMENT_AI_SCAN':
      return { ...state, aiScanCount: state.aiScanCount + 1 };
    case 'SET_AI_RESULT':
      return { ...state, lastAIResult: action.payload };
    default:
      return state;
  }
};

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
  const frameSkipCounter = useRef(0);
  const lastScanTime = useRef(0);
  
  // Use useReducer for optimized state management
  const [state, dispatch] = useReducer(scannerReducer, initialState);

  // Constants for performance optimization
  const FRAME_SKIP_COUNT = 4; // Process every 4th frame
  const OCR_TIMEOUT = 2000; // 2 seconds before OCR fallback
  const MAX_WIDTH = 800;
  const MAX_HEIGHT = 600;
  const JPEG_QUALITY = 0.7;

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

  // AI scanning with continuous frame capture
  const aiIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const performAIScan = useCallback(async (): Promise<void> => {
    if (!videoRef.current || !state.isUsingGrokOCR) return;

    dispatch({ type: 'INCREMENT_AI_SCAN' });
    dispatch({ type: 'SET_DEBUG_INFO', payload: `AI scanning frame ${state.aiScanCount + 1}...` });

    try {
      const video = videoRef.current;
      const canvas = CanvasPool.get();
      const ctx = canvas.getContext('2d')!;

      // Scale down for performance
      const scale = Math.min(MAX_WIDTH / video.videoWidth, MAX_HEIGHT / video.videoHeight);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      
      CanvasPool.release(canvas);

      const { data: response } = await supabase.functions.invoke('grok-ocr', {
        body: { imageData: imageDataUrl }
      });

      if (!response || !state.isUsingGrokOCR) return;

      const result = response;
      
      // Check for barcode first
      const barcodeMatches = result.text?.match(/\b\d{8,14}\b/g);
      
      if (barcodeMatches?.[0]) {
        const barcodeText = barcodeMatches[0];
        
        if (barcodeText !== state.lastScan && !state.scanCooldown) {
          const normalizedGtin = normalizeGtin(barcodeText, 'AI');
          onScan(normalizedGtin, 'AI');
          
          dispatch({ type: 'SCAN_SUCCESS', payload: { result: barcodeText, format: 'AI' } });
          dispatch({ type: 'SET_DEBUG_INFO', payload: `AI found barcode: ${barcodeText}` });
          dispatch({ type: 'SET_GROK_OCR', payload: false });

          setTimeout(() => {
            dispatch({ type: 'SET_COOLDOWN', payload: false });
            dispatch({ type: 'SET_DEBUG_INFO', payload: 'Paused - click Resume to continue scanning' });
          }, 1000);
        }
        return;
      }

      // If no barcode, store the product info for potential use
      if (result.text && result.text.length > 20) {
        dispatch({ type: 'SET_AI_RESULT', payload: result.text });
        
        // Extract product name from the text
        const lines = result.text.split('\n').filter(line => line.trim().length > 0);
        const productName = lines[0] || 'Product detected';
        
        dispatch({ type: 'SET_DEBUG_INFO', payload: `AI found: ${productName} (no barcode visible)` });
      } else {
        dispatch({ type: 'SET_DEBUG_INFO', payload: `AI scan ${state.aiScanCount + 1} - no product detected` });
      }
    } catch (error) {
      console.error('AI scan error:', error);
      dispatch({ type: 'SET_DEBUG_INFO', payload: `AI scan ${state.aiScanCount + 1} failed - retrying...` });
    }
  }, [state.isUsingGrokOCR, state.aiScanCount, state.lastScan, state.scanCooldown, onScan, MAX_WIDTH, MAX_HEIGHT, JPEG_QUALITY]);

  // Toggle AI mode and manage continuous scanning
  const toggleAIMode = useCallback(() => {
    if (state.isUsingGrokOCR) {
      // Stop AI mode
      dispatch({ type: 'SET_GROK_OCR', payload: false });
      if (aiIntervalRef.current) {
        clearInterval(aiIntervalRef.current);
        aiIntervalRef.current = null;
      }
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'Camera live - scanning...' });
    } else {
      // Start AI mode
      dispatch({ type: 'SET_GROK_OCR', payload: true });
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'AI Mode - capturing frames...' });
      
      // Start continuous AI scanning
      aiIntervalRef.current = setInterval(() => {
        performAIScan();
      }, 2500); // Scan every 2.5 seconds
      
      // Perform first scan immediately
      performAIScan();
    }
  }, [state.isUsingGrokOCR, performAIScan]);

  // Cleanup interval on unmount or when stopping
  useEffect(() => {
    return () => {
      if (aiIntervalRef.current) {
        clearInterval(aiIntervalRef.current);
      }
    };
  }, []);

  // Stop AI interval when not in AI mode
  useEffect(() => {
    if (!state.isUsingGrokOCR && aiIntervalRef.current) {
      clearInterval(aiIntervalRef.current);
      aiIntervalRef.current = null;
    }
  }, [state.isUsingGrokOCR]);

  // Handle successful barcode scan
  const handleScanSuccess = useCallback((result: any, format: string) => {
    if (result !== state.lastScan && !state.scanCooldown) {
      const normalizedGtin = normalizeGtin(result, format);
      onScan(normalizedGtin, format);
      
      dispatch({ type: 'SCAN_SUCCESS', payload: { result, format } });

      setTimeout(() => {
        dispatch({ type: 'SET_COOLDOWN', payload: false });
        dispatch({ type: 'SET_DEBUG_INFO', payload: 'Paused - click Resume to continue scanning' });
      }, 1000);
    }
  }, [state.lastScan, state.scanCooldown, onScan]);

  // Handle scan errors
  const handleScanError = useCallback(() => {
    dispatch({ type: 'SCAN_ERROR' });
  }, []);

  // Start scanning with optimization
  const startScanning = useCallback(async () => {
    dispatch({ type: 'START_SCANNING' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280, max: 1920 }, // Limit max resolution
          height: { ideal: 720, max: 1080 }
        }
      });
      
      streamRef.current = stream;
      dispatch({ type: 'SET_PERMISSION', payload: true });
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'Camera live - scanning...' });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Start ZXing continuous scanning with optimized frame processing
      if (readerRef.current && videoRef.current) {
        await readerRef.current.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, error) => {
            // Frame skipping for performance - only process every nth frame
            frameSkipCounter.current = (frameSkipCounter.current + 1) % FRAME_SKIP_COUNT;
            if (frameSkipCounter.current !== 0) return;

            // Don't process if paused or using AI
            if (state.isPaused || state.isUsingGrokOCR) return;

            if (result) {
              handleScanSuccess(result.getText(), result.getBarcodeFormat().toString());
            } else if (error) {
              handleScanError();
            }
          }
        );
      }
      
    } catch (error: any) {
      dispatch({ type: 'SET_DEBUG_INFO', payload: `Error: ${error.message}` });
      dispatch({ type: 'SET_PERMISSION', payload: false });
      dispatch({ type: 'STOP_SCANNING' });
      onError?.(error.message);
    }
  }, [handleScanSuccess, handleScanError, state.isPaused, state.isUsingGrokOCR, FRAME_SKIP_COUNT]);

  const resumeScanning = useCallback(() => {
    dispatch({ type: 'SET_PAUSED', payload: false });
    dispatch({ type: 'SET_DEBUG_INFO', payload: 'Resumed scanning...' });
  }, []);

  const stopScanning = useCallback(() => {
    dispatch({ type: 'STOP_SCANNING' });
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

          {state.isScanning && !state.isPaused && (
            <Button 
              onClick={toggleAIMode} 
              variant={state.isUsingGrokOCR ? "destructive" : "secondary"}
              className={state.isUsingGrokOCR ? 
                "bg-red-500 hover:bg-red-600 text-white flex-shrink-0" : 
                "bg-blue-500 hover:bg-blue-600 text-white flex-shrink-0"
              }
            >
              {state.isUsingGrokOCR ? (
                <>
                  <X className="h-4 w-4 mr-2" />
                  Stop AI ({state.aiScanCount})
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  AI Mode
                </>
              )}
            </Button>
          )}

          {/* Show AI result if product found but no barcode */}
          {state.lastAIResult && state.isUsingGrokOCR && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <h4 className="font-medium text-blue-900 mb-1">Product Detected:</h4>
              <p className="text-sm text-blue-800 mb-2">
                {state.lastAIResult.split('\n').slice(0, 3).join(' • ')}
              </p>
              <Button 
                onClick={() => {
                  // Trigger product form with AI data
                  onScan('MANUAL_ENTRY', 'AI', state.lastAIResult);
                  dispatch({ type: 'SET_GROK_OCR', payload: false });
                  if (aiIntervalRef.current) {
                    clearInterval(aiIntervalRef.current);
                    aiIntervalRef.current = null;
                  }
                }}
                size="sm"
                className="bg-green-500 hover:bg-green-600 text-white"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add This Product
              </Button>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center">
          {state.debugInfo}
        </div>
      </CardContent>
    </Card>
  );
};