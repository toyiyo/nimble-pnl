import React, { useEffect, useRef, useReducer, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Square, Loader2, Target, AlertCircle, Zap, X, Plus, CheckCircle2 } from 'lucide-react';
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
  isUsingAIMode: boolean;
  isProcessingAI: boolean;
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
  | { type: 'SET_AI_MODE'; payload: boolean }
  | { type: 'SET_PROCESSING_AI'; payload: boolean }
  | { type: 'SET_AI_RESULT'; payload: string | null };

const initialState: ScannerState = {
  isScanning: false, 
  hasPermission: null,
  debugInfo: 'Ready to start',
  lastScan: '',
  scanCooldown: false,
  isPaused: false,
  isUsingAIMode: false,
  isProcessingAI: false,
  lastAIResult: null
};

const scannerReducer = (state: ScannerState, action: ScannerAction): ScannerState => {
  switch (action.type) {
    case 'START_SCANNING':
      return { ...state, isScanning: true, debugInfo: 'Starting scanner...', lastAIResult: null };
    case 'STOP_SCANNING':
      return { ...state, isScanning: false, debugInfo: 'Stopped', isUsingAIMode: false, isProcessingAI: false, lastAIResult: null };
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
    case 'SET_AI_MODE':
      return { ...state, isUsingAIMode: action.payload, lastAIResult: action.payload ? null : state.lastAIResult };
    case 'SET_PROCESSING_AI':
      return { ...state, isProcessingAI: action.payload };
    case 'SET_AI_RESULT':
      return { ...state, lastAIResult: action.payload };
    default:
      return state;
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

  // Constants for performance optimization - AGGRESSIVE memory reduction
  const FRAME_SKIP_COUNT = 10; // Process only every 10th frame (~1-2 times/sec)
  const OCR_TIMEOUT = 2000; // 2 seconds before OCR fallback
  const MAX_WIDTH = 480; // Further reduced for memory
  const MAX_HEIGHT = 360; // Further reduced for memory
  const JPEG_QUALITY = 0.5; // Lower quality for less memory

  // Initialize reader once with Android-optimized hints
  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,     // Added for Android compatibility
      BarcodeFormat.CODE_93,     // Added for Android compatibility
      BarcodeFormat.ITF,         // Added for Android compatibility
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.PURE_BARCODE, false);
    hints.set(DecodeHintType.ASSUME_GS1, false); // Better for Android

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

    // Stop all media tracks - this is critical for memory cleanup
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
    }

    // Clear video element properly
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.load(); // Force video element reset
    }

    CanvasPool.cleanup();
  }, []);

  // Capture a single photo for AI processing
  const capturePhotoForAI = useCallback(async (): Promise<void> => {
    if (!videoRef.current || state.isProcessingAI) return;

    dispatch({ type: 'SET_PROCESSING_AI', payload: true });
    dispatch({ type: 'SET_DEBUG_INFO', payload: 'Processing image with AI...' });

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

      const { data: response, error } = await supabase.functions.invoke('grok-ocr', {
        body: { imageData: imageDataUrl }
      });

      if (error) {
        throw error;
      }

      if (!response) {
        throw new Error('No response from AI');
      }

      const result = response;
      
      // Check for barcode first
      const barcodeMatches = result.text?.match(/\b\d{8,14}\b/g);
      
      if (barcodeMatches?.[0]) {
        const barcodeText = barcodeMatches[0];
        
        if (barcodeText !== state.lastScan) {
          // Pass the raw barcode without normalization
          onScan(barcodeText, 'AI');
          
          dispatch({ type: 'SCAN_SUCCESS', payload: { result: barcodeText, format: 'AI' } });
          dispatch({ type: 'SET_DEBUG_INFO', payload: `AI found barcode: ${barcodeText}` });
          dispatch({ type: 'SET_AI_MODE', payload: false });
          dispatch({ type: 'SET_PROCESSING_AI', payload: false });

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
        dispatch({ type: 'SET_PROCESSING_AI', payload: false });
      } else {
        dispatch({ type: 'SET_DEBUG_INFO', payload: 'No product detected. Try taking another photo.' });
        dispatch({ type: 'SET_PROCESSING_AI', payload: false });
      }
    } catch (error) {
      console.error('AI scan error:', error);
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'AI processing failed. Please try again.' });
      dispatch({ type: 'SET_PROCESSING_AI', payload: false });
      onError?.('AI processing failed. Please try again.');
    }
  }, [state.isProcessingAI, state.lastScan, onScan, onError, MAX_WIDTH, MAX_HEIGHT, JPEG_QUALITY]);

  // Toggle AI mode
  const toggleAIMode = useCallback(() => {
    if (state.isUsingAIMode) {
      // Exit AI mode
      dispatch({ type: 'SET_AI_MODE', payload: false });
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'Camera live - scanning...' });
    } else {
      // Enter AI mode
      dispatch({ type: 'SET_AI_MODE', payload: true });
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'AI Mode - tap "Capture Photo" to scan' });
    }
  }, [state.isUsingAIMode]);

  // Handle successful barcode scan - STOP camera to free memory
  const handleScanSuccess = useCallback((result: any, format: string) => {
    if (result !== state.lastScan && !state.scanCooldown) {
      // Pass the raw barcode without normalization
      onScan(result, format);
      
      dispatch({ type: 'SCAN_SUCCESS', payload: { result, format } });
      
      // CRITICAL: Stop camera stream immediately to free memory
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

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
      // Recreate reader if it was cleared
      if (!readerRef.current) {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.DATA_MATRIX,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.PURE_BARCODE, false);
        hints.set(DecodeHintType.ASSUME_GS1, false);
        readerRef.current = new BrowserMultiFormatReader(hints);
      }

      // Aggressive memory optimization - minimal resolution for barcode scanning
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 640, max: 800 },  // Much lower for memory efficiency
          height: { ideal: 480, max: 600 },
          frameRate: { ideal: 10, max: 15 }   // Lower frame rate reduces memory pressure
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
            if (state.isPaused || state.isUsingAIMode) return;

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
  }, [handleScanSuccess, handleScanError, state.isPaused, state.isUsingAIMode, FRAME_SKIP_COUNT, onError]);

  const resumeScanning = useCallback(async () => {
    dispatch({ type: 'SET_PAUSED', payload: false });
    dispatch({ type: 'SET_DEBUG_INFO', payload: 'Restarting camera...' });
    
    // Restart the camera stream from scratch for clean state
    await startScanning();
  }, [startScanning]);

  const stopScanning = useCallback(() => {
    dispatch({ type: 'STOP_SCANNING' });
    
    // Cleanup all resources (stops video stream)
    cleanup();
    
    // Force clear the reader reference to ensure decode loop stops
    readerRef.current = null;
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
    
    // CRITICAL: Cleanup on unmount to prevent memory leaks
    return () => {
      stopScanning();
    };
  }, [autoStart, startScanning, stopScanning]);

  return (
    <Card className={cn(
      'w-full max-w-md mx-auto border-2 transition-all duration-300',
      state.isScanning 
        ? 'border-transparent bg-gradient-to-br from-purple-500/10 via-background to-blue-500/10 shadow-lg shadow-purple-500/10'
        : 'border-border'
    )}>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center gap-2 justify-center">
          <div className={cn(
            'rounded-lg p-2 transition-all duration-300',
            state.isScanning
              ? 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/30'
              : 'bg-muted'
          )}>
            <Camera className={cn('h-5 w-5', state.isScanning ? 'text-white' : 'text-foreground')} />
          </div>
          Barcode Scanner
        </CardTitle>
        <CardDescription>
          High-performance scanner with AI fallback
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative aspect-video bg-muted rounded-xl overflow-hidden border-2 border-border">
          {state.isScanning ? (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
                aria-label={state.isPaused ? 'Camera paused' : 'Camera scanning for barcodes'}
              />
              {/* Minimal Scanning Reticle - Transparent for clear visibility */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-64 h-40">
                  {/* Subtle dashed border outline only */}
                  <div className="absolute inset-0 rounded-xl border-2 border-dashed border-white/70 shadow-lg" />
                  
                  {/* Corner markers with glow - no solid fill blocking view */}
                  <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl shadow-lg shadow-white/50" />
                  <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl shadow-lg shadow-white/50" />
                  <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl shadow-lg shadow-white/50" />
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl shadow-lg shadow-white/50" />
                  
                  {/* Subtle center crosshair */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-1 h-8 bg-white/50 rounded-full shadow-sm" />
                    <div className="absolute w-8 h-1 bg-white/50 rounded-full shadow-sm" />
                  </div>
                </div>
              </div>
              
              {/* Status badges */}
              {state.scanCooldown && (
                <div className="absolute top-3 left-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg shadow-emerald-500/30 animate-in zoom-in duration-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Scanned!
                </div>
              )}
              {state.isPaused && !state.scanCooldown && (
                <div className="absolute top-3 left-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg shadow-amber-500/30">
                  Paused
                </div>
              )}
              {state.isUsingAIMode && (
                <div className="absolute top-3 right-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg shadow-purple-500/30 flex items-center gap-1.5 animate-pulse">
                  <Zap className="h-4 w-4" />
                  AI Mode
                </div>
              )}
              {state.isProcessingAI && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
                  <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-6 flex flex-col items-center gap-3 shadow-2xl border-2 border-purple-500/20">
                    <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
                    <p className="text-sm font-semibold">Processing with AI...</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center space-y-3">
                <Target className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                <p className="text-sm font-medium text-muted-foreground">
                  {state.hasPermission === false 
                    ? 'Camera access denied'
                    : 'Click start to begin scanning'
                  }
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button 
            onClick={toggleScanning}
            variant={state.isScanning ? "destructive" : "default"}
            className={cn(
              "flex-1 transition-all duration-300 hover:scale-[1.02]",
              !state.isScanning && "bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 shadow-lg shadow-purple-500/30"
            )}
            aria-label={state.isScanning ? "Stop scanning" : "Start scanning"}
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

          {state.isPaused && !state.isUsingAIMode && (
            <Button 
              onClick={resumeScanning} 
              variant="outline" 
              className="flex-1 sm:flex-initial border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-500 transition-all duration-300"
              aria-label="Resume scanning"
            >
              Resume
            </Button>
          )}

          {state.isScanning && !state.isPaused && (
            <Button 
              onClick={toggleAIMode} 
              variant={state.isUsingAIMode ? "destructive" : "secondary"}
              className={cn(
                "flex-1 sm:flex-initial whitespace-nowrap transition-all duration-300 hover:scale-[1.02]",
                state.isUsingAIMode ? 
                  "bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-lg shadow-purple-500/30" : 
                  "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg shadow-blue-500/30"
              )}
              aria-label={state.isUsingAIMode ? "Exit AI mode" : "Enable AI mode"}
            >
              {state.isUsingAIMode ? (
                <>
                  <X className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Exit AI Mode</span>
                  <span className="sm:hidden">Exit AI</span>
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">AI Mode</span>
                  <span className="sm:hidden">AI</span>
                </>
              )}
            </Button>
          )}

          {state.isUsingAIMode && !state.isProcessingAI && (
            <Button 
              onClick={capturePhotoForAI}
              variant="default"
              className="flex-1 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-lg shadow-purple-500/30 transition-all duration-300 hover:scale-[1.02]"
              aria-label="Capture photo for AI processing"
            >
              <Plus className="h-4 w-4 mr-2" />
              Capture Photo
            </Button>
          )}
        </div>

        {/* Help text and status */}
        {/* Show AI result if product found but no barcode */}
        {state.lastAIResult && state.isUsingAIMode && !state.isProcessingAI && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="font-medium text-blue-900 mb-1">Product Detected:</h4>
            <p className="text-sm text-blue-800 mb-2">
              {state.lastAIResult.split('\n').slice(0, 3).join(' • ')}
            </p>
            <div className="flex gap-2">
              <Button 
                onClick={() => {
                  // Trigger product form with AI data
                  onScan('MANUAL_ENTRY', 'AI', state.lastAIResult);
                  dispatch({ type: 'SET_AI_MODE', payload: false });
                }}
                size="sm"
                className="bg-green-500 hover:bg-green-600 text-white flex-1"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add This Product
              </Button>
              <Button 
                onClick={capturePhotoForAI}
                size="sm"
                variant="outline"
                className="flex-1"
              >
                <Camera className="h-3 w-3 mr-1" />
                Try Again
              </Button>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground text-center">
          {state.debugInfo}
        </div>
      </CardContent>
    </Card>
  );
};