import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Square, Loader2 } from 'lucide-react';
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
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('Ready to start');

  const startScanning = async () => {
    console.log('🎯 startScanning called');
    setDebugInfo('Starting scanner...');
    
    if (!videoRef.current) {
      console.log('❌ No video ref');
      setDebugInfo('Error: No video element');
      return;
    }

    try {
      console.log('🟢 Requesting camera...');
      setDebugInfo('Requesting camera access...');
      setIsScanning(true);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      console.log('✅ Camera access granted');
      setDebugInfo('Camera access granted!');
      setHasPermission(true);
      
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      
      console.log('📹 Video playing');
      setDebugInfo('Camera is live!');
      
      // Simple test - simulate a scan after 3 seconds
      setTimeout(() => {
        onScan('123456789012', 'TEST');
        setDebugInfo('Test scan completed!');
      }, 3000);
      
    } catch (error: any) {
      console.error('❌ Camera error:', error);
      setDebugInfo(`Error: ${error.message}`);
      setHasPermission(false);
      setIsScanning(false);
      onError?.(error.message);
    }
  };

  const stopScanning = () => {
    console.log('🛑 Stopping scanner');
    setDebugInfo('Stopping...');
    
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
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
          Point your camera at a barcode to scan it
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
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-32 border-2 border-primary border-dashed rounded-lg bg-primary/10">
                  <Square className="w-full h-full text-primary/30" />
                </div>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {hasPermission === false
                    ? 'Camera access denied'
                    : 'Press Start to begin scanning'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="text-center p-2 bg-muted rounded text-sm">
          Debug: {debugInfo}
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
                <Camera className="h-4 w-4 mr-2" />
                Start Scanning
              </>
            )}
          </Button>
        </div>

        {debugInfo && (
          <div className="text-center p-2 bg-muted rounded">
            <p className="text-sm text-muted-foreground">Status: {debugInfo}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};