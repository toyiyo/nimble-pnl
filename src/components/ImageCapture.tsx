import React, { useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Image as ImageIcon, Upload, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageCaptureProps {
  onImageCaptured: (imageBlob: Blob, imageUrl: string) => void;
  onError?: (error: string) => void;
  className?: string;
  disabled?: boolean;
}

export const ImageCapture: React.FC<ImageCaptureProps> = ({
  onImageCaptured,
  onError,
  className,
  disabled = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startCamera = useCallback(async () => {
    console.log('🎥 Starting camera...');
    setIsLoading(true);
    
    // Add a small delay to ensure the video element is rendered
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!videoRef.current) {
      console.error('❌ Video ref not available');
      setIsLoading(false);
      onError?.('Video element not ready. Please try again.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 }
        }
      });

      console.log('📹 Got media stream:', stream.id);

      const video = videoRef.current;
      if (!video) {
        console.error('❌ Video element disappeared');
        setIsLoading(false);
        onError?.('Video element not available');
        return;
      }

      video.srcObject = stream;
      
      // Set up event handlers
      const handleLoadedMetadata = () => {
        console.log('🎬 Video metadata loaded');
        if (videoRef.current) {
          videoRef.current.play().then(() => {
            console.log('▶️ Video playing');
            setIsStreaming(true);
            setHasPermission(true);
            setIsLoading(false);
          }).catch((error) => {
            console.error('❌ Video play error:', error);
            onError?.(`Video play failed: ${error.message}`);
            setIsLoading(false);
          });
        }
      };

      const handleVideoError = (error: any) => {
        console.error('❌ Video error:', error);
        onError?.('Video failed to load');
        setIsLoading(false);
      };

      video.onloadedmetadata = handleLoadedMetadata;
      video.onerror = handleVideoError;

      // Fallback timeout in case metadata never loads
      setTimeout(() => {
        if (videoRef.current && videoRef.current.readyState >= 1) {
          console.log('🕒 Fallback: Video ready via timeout');
          handleLoadedMetadata();
        } else if (isLoading) {
          console.log('🕒 Timeout: Stopping loading spinner');
          setIsLoading(false);
          onError?.('Camera initialization timed out');
        }
      }, 5000);
      
    } catch (error: any) {
      console.error('❌ Camera access error:', error);
      setHasPermission(false);
      setIsLoading(false);
      onError?.(error.message);
    }
  }, [onError, isLoading]);

  const stopCamera = useCallback(() => {
    console.log('🛑 Stopping camera...');
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('📹 Stopped track:', track.kind);
      });
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  const capturePhoto = useCallback(() => {
    console.log('📸 Capturing photo...');
    if (!videoRef.current || !canvasRef.current) {
      console.error('❌ Missing video or canvas ref');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) {
      console.error('❌ Could not get canvas context');
      return;
    }

    // Make sure video has dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.error('❌ Video has no dimensions');
      onError?.('Camera not ready. Please try again.');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    console.log(`📷 Photo captured: ${video.videoWidth}x${video.videoHeight}`);

    canvas.toBlob((blob) => {
      if (blob) {
        const imageUrl = URL.createObjectURL(blob);
        setCapturedImage(imageUrl);
        onImageCaptured(blob, imageUrl);
        stopCamera();
        console.log('✅ Photo processed and callback triggered');
      } else {
        console.error('❌ Failed to create blob from canvas');
        onError?.('Failed to capture photo');
      }
    }, 'image/jpeg', 0.8);
  }, [onImageCaptured, stopCamera, onError]);

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

  return (
    <Card className={cn('w-full max-w-md mx-auto', className)}>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center gap-2 justify-center">
          <Camera className="h-5 w-5" />
          Image Capture
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {capturedImage ? (
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
              {isLoading ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                    <p className="text-sm text-muted-foreground">Starting camera...</p>
                  </div>
                </div>
              ) : isStreaming ? (
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {hasPermission === false
                        ? 'Camera access denied'
                        : 'Ready to start camera'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {!isStreaming ? (
                <>
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
                  <Button
                    variant="outline"
                    onClick={() => {
                      console.log('📁 Opening file picker...');
                      fileInputRef.current?.click();
                    }}
                    disabled={disabled}
                    className="flex-1"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </Button>
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
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            console.log('📁 File selected:', e.target.files?.[0]?.name);
            handleFileUpload(e);
          }}
          className="hidden"
        />

        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
};