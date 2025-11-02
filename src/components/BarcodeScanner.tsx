import React, { useEffect, useRef, useReducer, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Square, Loader2, Target, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from "@/integrations/supabase/client";

interface BarcodeScannerProps {
  onScan: (result: string, format: string) => void;
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
}

type ScannerAction = 
  | { type: 'START_SCANNING' }
  | { type: 'STOP_SCANNING' }
  | { type: 'SET_PERMISSION'; payload: boolean }
  | { type: 'SET_DEBUG_INFO'; payload: string }
  | { type: 'SCAN_SUCCESS'; payload: { result: string; format: string } }
  | { type: 'SCAN_ERROR' }
  | { type: 'SET_COOLDOWN'; payload: boolean }
  | { type: 'SET_PAUSED'; payload: boolean };

const initialState: ScannerState = {
  isScanning: false, 
  hasPermission: null,
  debugInfo: 'Ready to start',
  lastScan: '',
  scanCooldown: false,
  isPaused: false,
};

const scannerReducer = (state: ScannerState, action: ScannerAction): ScannerState => {
  switch (action.type) {
    case 'START_SCANNING':
      return { ...state, isScanning: true, debugInfo: 'Starting scanner...' };
    case 'STOP_SCANNING':
      return { ...state, isScanning: false, debugInfo: 'Stopped' };
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
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<any>(null); // ZXing controls object
  const frameSkipCounter = useRef(0);
  const lastScanTime = useRef(0);
  const sessionIdRef = useRef(0); // Session token to kill late frames
  const decoderSessionRef = useRef(0); // Session id seen by decoder
  
  // Use useReducer for optimized state management
  const [state, dispatch] = useReducer(scannerReducer, initialState);

  // Constants for performance optimization - BALANCED for good scanning
  const FRAME_SKIP_COUNT = 3; // Process every 3rd frame (better scan rate)

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

  // Invalidate session to kill late frames
  const invalidateSession = useCallback(() => {
    decoderSessionRef.current = -1;
  }, []);

  // Cleanup function - FIXED ORDER: Controls → streamRef → video tracks → Replace video element (Safari fix)
  const cleanup = useCallback(() => {
    console.log('🧹 Starting cleanup...');
    
    // Invalidate session first to kill late frames
    invalidateSession();
    
    // 1) Stop ZXing controls first
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
        console.log('✅ Stopped ZXing controls');
      } catch (e) {
        console.error('Error stopping ZXing controls:', e);
      }
      controlsRef.current = null;
    }
    
    // 2) Stop any known stream (from our ref)
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(t => {
          t.stop();
          console.log('✅ Stopped track from streamRef:', t.kind);
        });
      } catch (e) {
        console.error('Error stopping streamRef tracks:', e);
      }
      streamRef.current = null;
    }
    
    // 3) Also stop anything still hanging off the video element
    const video = videoRef.current;
    const mediaStream = (video?.srcObject as MediaStream) || null;
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach(t => {
          t.stop();
          console.log('✅ Stopped track from video.srcObject:', t.kind);
        });
      } catch (e) {
        console.error('Error stopping video srcObject tracks:', e);
      }
    }
    
    // 4) Fully detach and reset video element (let React manage DOM)
    if (video) {
      try { video.pause(); } catch {}
      try { (video as any).srcObject = null; } catch {}
      try { video.removeAttribute('src'); } catch {}
      try { video.load(); } catch {}
      console.log('✅ Video element detached');
    }
    
    // 5) Cancel timers/raf + clear canvases
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    CanvasPool.cleanup();
    
    console.log('✅ Cleanup complete - camera should be released');
  }, [invalidateSession]);


  // Handle successful barcode scan - pause briefly to prevent duplicates
  const handleScanSuccess = useCallback((result: any, format: string) => {
    const now = Date.now();
    
    // Prevent duplicate scans within 1.5 seconds
    if (result === state.lastScan && (now - lastScanTime.current) < 1500) {
      return;
    }
    
    if (!state.scanCooldown) {
      lastScanTime.current = now;
      
      // Update UI first
      dispatch({ type: 'SET_DEBUG_INFO', payload: `Found ${format}: ${result}` });
      
      // Pass the raw barcode without normalization
      onScan(result, format);
      
      dispatch({ type: 'SCAN_SUCCESS', payload: { result, format } });
      
      // Brief cooldown to prevent rapid duplicate scans, but keep camera active
      setTimeout(() => {
        dispatch({ type: 'SET_COOLDOWN', payload: false });
        dispatch({ type: 'SET_PAUSED', payload: false });
        dispatch({ type: 'SET_DEBUG_INFO', payload: 'Camera active - scanning...' });
      }, 1500);
    }
  }, [state.lastScan, state.scanCooldown, onScan]);

  // Handle scan errors
  const handleScanError = useCallback(() => {
    dispatch({ type: 'SCAN_ERROR' });
  }, []);

  // Start scanning - Let ZXing own the stream (single source of truth)
  const startScanning = useCallback(async () => {
    // Guard: don't start if already running
    if (controlsRef.current) return;
    
    // Bump session token to invalidate old frames
    const mySession = ++sessionIdRef.current;
    decoderSessionRef.current = mySession;
    
    dispatch({ type: 'START_SCANNING' });

    try {
      // Stop any stale controls just in case
      if (controlsRef.current) {
        try { controlsRef.current.stop(); } catch {}
        controlsRef.current = null;
      }
      
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

      // Find back camera using ZXing's device enumeration
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const backCamera = devices.find(d => 
        /back|rear|environment/i.test(d.label)
      ) ?? devices[0];
      
      if (!backCamera) {
        throw new Error('No camera found');
      }

      dispatch({ type: 'SET_PERMISSION', payload: true });
      dispatch({ type: 'SET_DEBUG_INFO', payload: 'Camera live - scanning...' });

      // Let ZXing manage the stream - pass specific device ID
      const controls = await readerRef.current.decodeFromVideoDevice(
        backCamera.deviceId,
        videoRef.current!,
        (result, error) => {
          // Ignore late frames from old sessions
          if (decoderSessionRef.current !== mySession) return;
          
          // Frame skipping for performance - only process every nth frame
          frameSkipCounter.current = (frameSkipCounter.current + 1) % FRAME_SKIP_COUNT;
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
      
      // Store controls to properly stop the scanner later
      controlsRef.current = controls;
      // Capture the stream ZXing attached
      streamRef.current = (videoRef.current?.srcObject as MediaStream) ?? null;
      
    } catch (error: any) {
      dispatch({ type: 'SET_DEBUG_INFO', payload: `Error: ${error.message}` });
      dispatch({ type: 'SET_PERMISSION', payload: false });
      dispatch({ type: 'STOP_SCANNING' });
      onError?.(error.message);
    }
  }, [handleScanSuccess, handleScanError, state.isPaused, FRAME_SKIP_COUNT, onError]);

  const resumeScanning = useCallback(async () => {
    dispatch({ type: 'SET_PAUSED', payload: false });
    dispatch({ type: 'SET_DEBUG_INFO', payload: 'Restarting camera...' });
    
    // Restart the camera stream from scratch for clean state
    await startScanning();
  }, [startScanning]);

  const stopScanning = useCallback(() => {
    console.log('🛑 Stop scanning initiated');
    dispatch({ type: 'SET_DEBUG_INFO', payload: 'Stopping camera...' });
    
    invalidateSession();
    cleanup();
    // Don't null reader here - can race with internal stop
    
    dispatch({ type: 'STOP_SCANNING' });
  }, [cleanup, invalidateSession]);

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
    
    // CRITICAL: Cleanup on unmount to prevent memory leaks and camera indicator
    return () => {
      cleanup();
      dispatch({ type: 'STOP_SCANNING' });
    };
  }, [autoStart, startScanning, cleanup]);

  // Force cleanup when page is hidden (mobile Safari fix)
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        cleanup();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [cleanup]);

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
          High-performance continuous scanning
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Video container - always visible with min-height to prevent layout collapse */}
        <div className="relative aspect-video bg-muted rounded-xl overflow-hidden border-2 border-border min-h-[240px]">
          {state.isScanning ? (
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
              aria-label={state.isPaused ? 'Camera paused' : 'Camera scanning for barcodes'}
            />
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
          
          {/* Scanning Reticle - only show when actively scanning (not paused) */}
          {state.isScanning && !state.isPaused && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-64 h-40">
                {/* Subtle dashed border outline only */}
                <div className="absolute inset-0 rounded-xl border-2 border-dashed border-white/70 shadow-lg" />
                
                {/* Corner markers with glow */}
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
          )}
          
          {/* Status badges - independent of isScanning to prevent flash */}
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
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          {/* Primary scanning control */}
          {!state.isScanning ? (
            <Button 
              onClick={toggleScanning}
              variant="default"
              className="flex-1 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 shadow-lg shadow-purple-500/30 transition-all duration-300 hover:scale-[1.02]"
              aria-label="Start scanning"
            >
              <Camera className="h-4 w-4 mr-2" />
              Start Scanning
            </Button>
          ) : (
            <>
              {/* Stop button */}
              <Button 
                onClick={stopScanning}
                variant="destructive"
                className="flex-1 transition-all duration-300 hover:scale-[1.02]"
                aria-label="Stop scanning"
              >
              <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center">
          {state.debugInfo}
        </div>
      </CardContent>
    </Card>
  );
};