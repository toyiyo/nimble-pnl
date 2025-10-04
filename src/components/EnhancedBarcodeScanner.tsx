import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Bluetooth, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarcodeScanner } from './BarcodeScanner';
import { BluetoothBarcodeScanner } from './BluetoothBarcodeScanner';
import { KeyboardBarcodeScanner } from './KeyboardBarcodeScanner';

interface EnhancedBarcodeScannerProps {
  onScan: (result: string, format: string, aiData?: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

type ScanMode = 'camera' | 'bluetooth' | 'keyboard';

export const EnhancedBarcodeScanner: React.FC<EnhancedBarcodeScannerProps> = ({
  onScan,
  onError,
  className,
  autoStart = false
}) => {
  const [scanMode, setScanMode] = useState<ScanMode>('camera');

  // Check if Web Bluetooth is supported and detect iOS
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isBluetoothSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator && !isIOS;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Mode Toggle */}
      <div className="flex justify-center">
        <div className="bg-muted p-1 rounded-lg w-full">
          <div className="grid grid-cols-3 gap-1">
            <Button
              variant={scanMode === 'camera' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setScanMode('camera')}
              className="flex-1"
            >
              <Camera className="h-4 w-4 mr-1" />
              Camera
            </Button>
            <Button
              variant={scanMode === 'keyboard' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setScanMode('keyboard')}
              className="flex-1"
            >
              <Keyboard className="h-4 w-4 mr-1" />
              Keyboard
            </Button>
            <Button
              variant={scanMode === 'bluetooth' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setScanMode('bluetooth')}
              className="flex-1"
              disabled={!isBluetoothSupported}
            >
              <Bluetooth className="h-4 w-4 mr-1" />
              BLE
            </Button>
          </div>
        </div>
      </div>

      {/* Scanner Component */}
      {scanMode === 'camera' ? (
        <BarcodeScanner
          onScan={onScan}
          onError={onError}
          autoStart={autoStart}
        />
      ) : scanMode === 'keyboard' ? (
        <KeyboardBarcodeScanner
          onScan={onScan}
          onError={onError}
          autoStart={autoStart}
        />
      ) : (
        <BluetoothBarcodeScanner
          onScan={onScan}
          onError={onError}
          autoStart={autoStart}
        />
      )}

      {/* iOS Recommendation */}
      {isIOS && scanMode !== 'keyboard' && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4">
            <div className="text-sm text-blue-800">
              <strong>💡 iOS User Tip:</strong> For the best scanning experience on iOS with Bluetooth scanners, 
              use the <strong>Keyboard</strong> mode. It works with all iOS devices and browsers without any limitations.
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Browser compatibility notice for BLE */}
      {!isBluetoothSupported && scanMode === 'bluetooth' && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-4">
            <div className="text-sm text-orange-800">
              <strong>{isIOS ? 'iOS Limitation:' : 'Browser Compatibility:'}</strong> 
              {isIOS ? (
                <> iOS devices do not support Web Bluetooth API. Please use the <strong>Keyboard</strong> scanner mode instead, which works perfectly on iOS.</>
              ) : (
                <> Web Bluetooth API requires Chrome, Edge, or another compatible browser. Try the <strong>Keyboard</strong> mode as an alternative.</>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};