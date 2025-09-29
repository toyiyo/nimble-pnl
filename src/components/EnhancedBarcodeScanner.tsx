import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Bluetooth } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarcodeScanner } from './BarcodeScanner';
import { BluetoothBarcodeScanner } from './BluetoothBarcodeScanner';

interface EnhancedBarcodeScannerProps {
  onScan: (result: string, format: string, aiData?: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

type ScanMode = 'camera' | 'bluetooth';

export const EnhancedBarcodeScanner: React.FC<EnhancedBarcodeScannerProps> = ({
  onScan,
  onError,
  className,
  autoStart = false
}) => {
  const [scanMode, setScanMode] = useState<ScanMode>('camera');

  // Check if Web Bluetooth is supported
  const isBluetoothSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Mode Toggle */}
      <div className="flex justify-center">
        <div className="bg-muted p-1 rounded-lg w-full max-w-xs">
          <div className="grid grid-cols-2 gap-1">
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
              variant={scanMode === 'bluetooth' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setScanMode('bluetooth')}
              className="flex-1"
              disabled={!isBluetoothSupported}
            >
              <Bluetooth className="h-4 w-4 mr-1" />
              Bluetooth
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
      ) : (
        <BluetoothBarcodeScanner
          onScan={onScan}
          onError={onError}
          autoStart={autoStart}
        />
      )}

      {/* Browser compatibility notice */}
      {scanMode === 'bluetooth' && !isBluetoothSupported && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-4">
            <div className="text-sm text-orange-800">
              <strong>Note:</strong> Bluetooth scanning requires Chrome, Edge, or another browser with Web Bluetooth API support.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};