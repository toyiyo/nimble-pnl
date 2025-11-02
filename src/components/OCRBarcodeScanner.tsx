import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImageCapture } from '@/components/ImageCapture';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Camera, Loader2, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OCRBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  className?: string;
}

type ScanState = 'idle' | 'capturing' | 'processing' | 'success' | 'error';

export const OCRBarcodeScanner: React.FC<OCRBarcodeScannerProps> = ({
  onScan,
  onError,
  onClose,
  className
}) => {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to scan');
  const [detectedBarcode, setDetectedBarcode] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const handleImageCaptured = async (imageBlob: Blob, imageUrl: string) => {
    console.log('📸 Image captured for OCR barcode scanning');
    setCapturedImage(imageUrl);
    setScanState('processing');
    setStatusMessage('Analyzing image with AI...');

    try {
      // Convert blob to base64
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      const imageData = canvas.toDataURL('image/jpeg', 0.8);

      // Call grok-ocr function
      const { data: response, error } = await supabase.functions.invoke('grok-ocr', {
        body: { imageData }
      });

      if (error) {
        throw error;
      }

      if (!response) {
        throw new Error('No response from OCR service');
      }

      // Extract barcode from structured data first
      let barcode: string | null = null;
      
      if (response.structuredData?.upcBarcode) {
        barcode = response.structuredData.upcBarcode;
        console.log('✅ Found barcode in structured data:', barcode);
      } else if (response.text) {
        // Fallback: Try to find barcode pattern in raw text
        // Common barcode formats: UPC-A (12 digits), EAN-13 (13 digits), EAN-8 (8 digits)
        const barcodePattern = /\b\d{8,14}\b/g;
        const matches = response.text.match(barcodePattern);
        
        if (matches && matches.length > 0) {
          barcode = matches[0]; // Use first match
          console.log('✅ Found barcode in text:', barcode);
        }
      }

      if (barcode) {
        setDetectedBarcode(barcode);
        setScanState('success');
        setStatusMessage(`Barcode detected: ${barcode}`);
        
        // Pass to parent
        onScan(barcode, 'AI-OCR');
      } else {
        setScanState('error');
        setStatusMessage('No barcode detected. Please try again with better lighting or angle.');
        onError?.('No barcode detected in image');
      }
    } catch (error) {
      console.error('OCR scan error:', error);
      setScanState('error');
      setStatusMessage('OCR processing failed. Please try again.');
      onError?.(error instanceof Error ? error.message : 'OCR processing failed');
    }
  };

  const handleReset = () => {
    setScanState('idle');
    setStatusMessage('Ready to scan');
    setDetectedBarcode(null);
    setCapturedImage(null);
  };

  const getStateIcon = () => {
    switch (scanState) {
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin" />;
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Camera className="h-5 w-5" />;
    }
  };

  const getStateBadgeVariant = (): 'default' | 'secondary' | 'destructive' => {
    switch (scanState) {
      case 'success':
        return 'default';
      case 'error':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-lg transition-colors',
              scanState === 'success' && 'bg-green-500/10',
              scanState === 'error' && 'bg-destructive/10',
              scanState === 'processing' && 'bg-primary/10',
              scanState === 'idle' && 'bg-muted'
            )}>
              {getStateIcon()}
            </div>
            <div>
              <CardTitle className="text-lg">AI OCR Barcode Scanner</CardTitle>
              <CardDescription>Capture photo to detect barcode</CardDescription>
            </div>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <span className="sr-only">Close</span>
              ×
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <Badge variant={getStateBadgeVariant()} className="font-normal">
            {statusMessage}
          </Badge>
          {detectedBarcode && (
            <Badge variant="outline" className="font-mono">
              {detectedBarcode}
            </Badge>
          )}
        </div>

        {/* Image Capture Component */}
        {scanState === 'idle' && (
          <ImageCapture
            onImageCaptured={handleImageCaptured}
            onError={(error) => {
              setScanState('error');
              setStatusMessage(error);
              onError?.(error);
            }}
            disabled={scanState !== 'idle'}
            className="w-full"
          />
        )}

        {/* Processing State */}
        {scanState === 'processing' && capturedImage && (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden border border-border">
              <img 
                src={capturedImage} 
                alt="Captured for OCR" 
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="text-center text-white">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p className="text-sm font-medium">Analyzing barcode...</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Success State */}
        {scanState === 'success' && capturedImage && (
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden border border-green-500/50">
              <img 
                src={capturedImage} 
                alt="Successfully scanned" 
                className="w-full h-auto"
              />
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300 text-sm">
                <CheckCircle className="h-4 w-4" />
                <span className="font-medium">Barcode detected successfully!</span>
              </div>
            </div>
            <Button onClick={handleReset} variant="outline" className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" />
              Scan Another
            </Button>
          </div>
        )}

        {/* Error State */}
        {scanState === 'error' && (
          <div className="space-y-3">
            {capturedImage && (
              <div className="rounded-lg overflow-hidden border border-destructive/50">
                <img 
                  src={capturedImage} 
                  alt="Failed scan" 
                  className="w-full h-auto opacity-50"
                />
              </div>
            )}
            <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20">
              <div className="flex items-start gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Detection failed</p>
                  <p className="text-xs mt-1 opacity-90">
                    Tips: Ensure good lighting, hold camera steady, and center the barcode in frame.
                  </p>
                </div>
              </div>
            </div>
            <Button onClick={handleReset} variant="outline" className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        )}

        {/* Instructions */}
        {scanState === 'idle' && (
          <div className="bg-muted/50 p-3 rounded-lg text-sm text-muted-foreground">
            <p className="font-medium mb-1">How to use:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Position barcode in good lighting</li>
              <li>Take a clear, focused photo</li>
              <li>AI will detect and extract the barcode</li>
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
