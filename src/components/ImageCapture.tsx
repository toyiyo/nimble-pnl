import React, { useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Image as ImageIcon, Upload, X, Zap } from 'lucide-react';
import { useNativeCamera } from '@/hooks/useNativeCamera';
import { cn } from '@/lib/utils';

export interface ImageCaptureHandle {
  stopCamera: () => void;
}

interface ImageCaptureProps {
  onImageCaptured: (imageBlob: Blob, imageUrl: string) => void;
  onError?: (error: string) => void;
  className?: string;
  disabled?: boolean;
  autoStart?: boolean;
  allowUpload?: boolean;
  hideControls?: boolean;
  onCaptureRef?: (capture: () => Promise<Blob | null>) => void;
  preferredFacingMode?: 'user' | 'environment';
  // When set, downscale the captured JPEG so its width is at most this many
  // pixels and (if <= 480) request a lower-res getUserMedia ideal so the
  // device doesn't spin up a 1080p stream just to encode a 480px image.
  maxWidth?: number;
  // JPEG quality in [0, 1]. Defaults to 0.8 to match the previous behaviour.
  quality?: number;
}

export const ImageCapture = forwardRef<ImageCaptureHandle, ImageCaptureProps>(({
  onImageCaptured,
  onError,
  className,
  disabled = false,
  autoStart = false,
  allowUpload = true,
  hideControls = false,
  onCaptureRef,
  preferredFacingMode = 'environment',
  maxWidth,
  quality = 0.8,
}, ref) => {
  const { isNative, takePhoto: takeNativePhoto } = useNativeCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startCamera = useCallback(async () => {
    if (import.meta.env.DEV) { console.log('🎥 Starting camera...'); }
    setIsLoading(true);

    // Kiosk path passes maxWidth=480; no point asking the device for 1080p
    // just to downscale it. Keep high-res for the receipt/inventory paths.
    const lowRes = typeof maxWidth === 'number' && maxWidth <= 480;
    const videoConstraints = lowRes
      ? { facingMode: preferredFacingMode, width: { ideal: 640, min: 480 }, height: { ideal: 480, min: 360 } }
      : { facingMode: preferredFacingMode, width: { ideal: 1920, min: 640 }, height: { ideal: 1080, min: 480 } };

    // metadataFired guards the fallback path against the React-state closure
    // race: `isLoading` here is captured at startCamera-time, so once
    // setIsLoading(false) flips, the closure still reads `true` and would
    // re-invoke handleLoadedMetadata. A local flag stays in sync with the
    // actual lifecycle.
    let metadataFired = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

      if (import.meta.env.DEV) { console.log('📹 Got media stream:', stream.id); }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        const handleLoadedMetadata = () => {
          if (metadataFired) return;
          metadataFired = true;
          if (import.meta.env.DEV) { console.log('🎬 Video metadata loaded'); }
          if (videoRef.current) {
            videoRef.current.play().then(() => {
              if (import.meta.env.DEV) { console.log('▶️ Video playing'); }
              setIsStreaming(true);
              setHasPermission(true);
              setIsLoading(false);
            }).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              if (import.meta.env.DEV) { console.error('❌ Video play error:', message); }
              onError?.(`Video play failed: ${message}`);
              setIsLoading(false);
            });
          }
        };

        const handleVideoError = (event: Event | string) => {
          if (import.meta.env.DEV) { console.error('❌ Video error:', event); }
          onError?.('Video failed to load');
          setIsLoading(false);
        };

        videoRef.current.onloadedmetadata = handleLoadedMetadata;
        videoRef.current.onerror = handleVideoError;

        // Some Android WebViews never fire `loadedmetadata` even after the
        // stream attaches, so we poll once at 5s and force-resolve if the
        // element reports it has metadata anyway.
        setTimeout(() => {
          if (metadataFired) return;
          if (videoRef.current && videoRef.current.readyState >= 1) {
            if (import.meta.env.DEV) { console.log('🕒 Fallback: Video ready via timeout'); }
            handleLoadedMetadata();
          } else {
            if (import.meta.env.DEV) { console.log('🕒 Timeout: Stopping loading spinner'); }
            setIsLoading(false);
            onError?.('Camera initialization timed out');
          }
        }, 5000);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (import.meta.env.DEV) { console.error('❌ Camera access error:', error); }
      setHasPermission(false);
      setIsLoading(false);
      onError?.(message);
    }
  }, [onError, preferredFacingMode, maxWidth]);

  const stopCamera = useCallback(() => {
  if (import.meta.env.DEV) { console.log('🛑 Stopping camera...'); }
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => {
        track.stop();
  if (import.meta.env.DEV) { console.log('📹 Stopped track:', track.kind); }
      });
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  // Expose stopCamera so the parent (e.g. KioskMode) can tear the stream
  // down synchronously before unmounting — otherwise the camera LED stays
  // on for a render tick on low-end Android.
  useImperativeHandle(ref, () => ({ stopCamera }), [stopCamera]);

  const capturePhoto = useCallback(async () => {
  if (import.meta.env.DEV) { console.log('📸 Capturing photo...'); }
    if (!videoRef.current || !canvasRef.current) {
  if (import.meta.env.DEV) { console.error('❌ Missing video or canvas ref'); }
  return null;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) {
  if (import.meta.env.DEV) { console.error('❌ Could not get canvas context'); }
  return null;
    }

    // Make sure video has dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
  if (import.meta.env.DEV) { console.error('❌ Video has no dimensions'); }
  onError?.('Camera not ready. Please try again.');
  return null;
    }

    // Downscale on the canvas before encoding when maxWidth is set. The kiosk
    // selfie path uses 480px; a 4–8x area reduction shrinks the JPEG from
    // ~1 MB to ~50 KB and removes the CORS-preflighted upload from the
    // critical path.
    const scale = typeof maxWidth === 'number' && maxWidth > 0
      ? Math.min(1, maxWidth / video.videoWidth)
      : 1;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (import.meta.env.DEV) { console.log(`📷 Photo captured: ${canvas.width}x${canvas.height} (source ${video.videoWidth}x${video.videoHeight}, scale ${scale.toFixed(2)}, q ${quality})`); }

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const imageUrl = URL.createObjectURL(blob);
          setCapturedImage(imageUrl);
          onImageCaptured(blob, imageUrl);
          stopCamera();
          if (import.meta.env.DEV) { console.log('✅ Photo processed and callback triggered'); }
          resolve(blob);
        } else {
          if (import.meta.env.DEV) { console.error('❌ Failed to create blob from canvas'); }
          onError?.('Failed to capture photo');
          resolve(null);
        }
      }, 'image/jpeg', quality);
    });
  }, [onImageCaptured, stopCamera, onError, maxWidth, quality]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      onError?.('Please select an image file');
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    setCapturedImage(imageUrl);
    onImageCaptured(file, imageUrl);
  }, [onImageCaptured, onError]);

  const resetCapture = useCallback(() => {
    setCapturedImage(null);
    if (capturedImage) {
      URL.revokeObjectURL(capturedImage);
    }
  }, [capturedImage]);

  const handleNativeCapture = useCallback(async () => {
    setIsLoading(true);
    try {
      const blob = await takeNativePhoto();
      if (blob) {
        const imageUrl = URL.createObjectURL(blob);
        setCapturedImage(imageUrl);
        onImageCaptured(blob, imageUrl);
      } else {
        onError?.('Failed to capture photo');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Camera error';
      onError?.(message);
    } finally {
      setIsLoading(false);
    }
  }, [takeNativePhoto, onImageCaptured, onError]);

  // Auto-start camera when requested
  React.useEffect(() => {
    if (autoStart && !isStreaming && hasPermission !== false && !isLoading) {
      startCamera();
    }
  }, [autoStart, isStreaming, hasPermission, isLoading, startCamera]);

  // Expose capture function upward when requested
  React.useEffect(() => {
    if (onCaptureRef) {
      onCaptureRef(capturePhoto);
    }
  }, [capturePhoto, onCaptureRef]);

  return (
    <Card className={cn('w-full max-w-md mx-auto', className)}>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center gap-2 justify-center">
          <Camera className="h-5 w-5" />
          Image Capture
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isNative ? (
          <div className="space-y-4">
            {capturedImage ? (
              <div className="relative">
                <img
                  src={capturedImage}
                  alt="Captured photo"
                  className="w-full h-48 object-cover rounded-lg"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={resetCapture}
                  className="absolute top-2 right-2"
                  aria-label="Remove captured photo"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6">
                <Camera className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Use native camera to take a photo</p>
              </div>
            )}
            {!hideControls && !capturedImage && (
              <Button
                onClick={handleNativeCapture}
                disabled={disabled || isLoading}
                className="w-full"
                aria-label="Take photo with native camera"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Capturing...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Take Photo
                  </>
                )}
              </Button>
            )}
          </div>
        ) : capturedImage ? (
          <div className="space-y-4">
            <div className="relative">
              <img
                src={capturedImage}
                alt="Captured product"
                className="w-full h-48 object-cover rounded-lg"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={resetCapture}
                className="absolute top-2 right-2"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                className={cn(
                  "w-full h-full object-cover",
                  !isStreaming && "hidden"
                )}
                autoPlay
                playsInline
                muted
              />
              {(() => {
                if (isLoading) {
                  return (
                    <div className="w-full h-full flex items-center justify-center absolute inset-0">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                        <p className="text-sm text-muted-foreground">Starting camera...</p>
                      </div>
                    </div>
                  );
                }
                if (!isStreaming) {
                  const statusText =
                    hasPermission === false
                      ? 'Camera access denied'
                      : autoStart
                      ? 'Starting camera...'
                      : 'Ready to start camera';
                  return (
                    <div className="w-full h-full flex items-center justify-center absolute inset-0">
                      <div className="text-center">
                        <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">{statusText}</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {!hideControls && (
              <div className="grid grid-cols-2 gap-2">
                {!isStreaming ? (
                  <>
                    {!autoStart && (
                      <Button
                        onClick={startCamera}
                        disabled={disabled || hasPermission === false || isLoading}
                        className="flex-1"
                      >
                        {isLoading ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Starting...
                          </>
                        ) : (
                          <>
                            <Camera className="h-4 w-4 mr-2" />
                            Camera
                          </>
                        )}
                      </Button>
                    )}
                    {allowUpload && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (import.meta.env.DEV) { console.log('📁 Opening file picker...'); }
                          fileInputRef.current?.click();
                        }}
                        disabled={disabled}
                        className="flex-1"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload
                      </Button>
                    )}
                    {autoStart && !allowUpload && (
                      <div className="text-xs text-muted-foreground col-span-2 text-center">
                        Waiting for camera...
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      onClick={capturePhoto}
                      disabled={disabled}
                      className="flex-1"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      Capture
                    </Button>
                    <Button
                      variant="outline"
                      onClick={stopCamera}
                      disabled={disabled}
                      className="flex-1"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {allowUpload && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              if (import.meta.env.DEV) { console.log('📁 File selected:', e.target.files?.[0]?.name); }
              handleFileUpload(e);
            }}
            className="hidden"
          />
        )}

        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
});

ImageCapture.displayName = 'ImageCapture';
