import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { MLKitBarcodeScanner } from './MLKitBarcodeScanner';
import { NativeBarcodeScanner } from './NativeBarcodeScanner';
import { Html5QrcodeScanner } from './Html5QrcodeScanner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Camera } from 'lucide-react';

interface SmartBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

type ScannerType = 'native' | 'fallback' | 'checking';

export const SmartBarcodeScanner = ({
  onScan,
  onError,
  className = '',
  autoStart = false,
}: SmartBarcodeScannerProps) => {
  const [scannerType, setScannerType] = useState<ScannerType>('checking');

  // On native Capacitor, use ML Kit scanner (bypasses web camera entirely)
  if (Capacitor.isNativePlatform()) {
    return (
      <div className="space-y-2">
        <div className="flex justify-center">
          <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
            <Sparkles className="w-3 h-3 mr-1" />
            ML Kit Native Scanner
          </Badge>
        </div>
        <MLKitBarcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
        />
      </div>
    );
  }

  useEffect(() => {
    // Check if native BarcodeDetector is available
    const checkNativeSupport = async () => {
      // More precise browser detection
      const userAgent = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(userAgent);
      const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
      const isFirefox = /Firefox/.test(userAgent);
      
      // Known browsers that DON'T support BarcodeDetector
      if (isIOS || isSafari || isFirefox) {
        console.log(`ℹ️ Browser detected: ${isIOS ? 'iOS' : isSafari ? 'Safari' : 'Firefox'} - using enhanced html5-qrcode scanner`);
        setScannerType('fallback');
        return;
      }

      // Test for BarcodeDetector API support
      try {
        if ('BarcodeDetector' in window) {
          // Verify it actually works by getting supported formats
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          
          if (formats && formats.length > 0) {
            console.log('✅ Native BarcodeDetector API supported!');
            console.log('📱 Supported formats:', formats);
            console.log('🖥️ Browser:', userAgent.includes('Chrome') ? 'Chrome' : 
                                    userAgent.includes('Edge') ? 'Edge' : 'Chromium-based');
            setScannerType('native');
            return;
          }
        }
      } catch (error) {
        console.warn('❌ Native BarcodeDetector check failed:', error);
      }

      // Fallback to html5-qrcode
      console.log('ℹ️ Using enhanced html5-qrcode fallback scanner');
      setScannerType('fallback');
    };

    checkNativeSupport();
  }, []);

  if (scannerType === 'checking') {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Initializing scanner...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {/* Scanner type indicator */}
      <div className="flex justify-center">
        {scannerType === 'native' ? (
          <Badge className="bg-gradient-to-r from-primary to-accent">
            <Sparkles className="w-3 h-3 mr-1" />
            Ultra-Fast Native Scanner
            {navigator.userAgent.includes('Chrome') && ' (Chrome)'}
            {navigator.userAgent.includes('Edge') && ' (Edge)'}
          </Badge>
        ) : (
          <Badge className="bg-gradient-to-r from-blue-500 to-cyan-600">
            <Camera className="w-3 h-3 mr-1" />
            Enhanced HTML5 Scanner
            {/iPad|iPhone|iPod/.test(navigator.userAgent) && ' (iOS Optimized)'}
            {/Android/.test(navigator.userAgent) && ' (Android Optimized)'}
            {/Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) && ' (Safari)'}
            {/Firefox/.test(navigator.userAgent) && ' (Firefox)'}
          </Badge>
        )}
      </div>

      {/* Render appropriate scanner */}
      {scannerType === 'native' ? (
        <NativeBarcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
          autoStart={autoStart}
        />
      ) : (
        <Html5QrcodeScanner
          onScan={onScan}
          onError={onError}
          className={className}
          autoStart={autoStart}
        />
      )}
    </div>
  );
};
