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

  // Check if Web Bluetooth is supported and detect iOS (including iPadOS)
  const isIOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.userAgent.includes('MacIntel') && navigator.maxTouchPoints > 1)
  );
  const isBluetoothSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator && !isIOS;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Enhanced Mode Toggle */}
      <Card className="border-2 border-transparent bg-gradient-to-br from-background via-background to-primary/5">
        <CardContent className="pt-4">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setScanMode('camera')}
              className={cn(
                'group relative overflow-hidden rounded-xl p-4 transition-all duration-300',
                'border-2 hover:scale-[1.02] hover:shadow-lg',
                scanMode === 'camera'
                  ? 'border-purple-500 bg-gradient-to-br from-purple-500/20 to-blue-500/20 shadow-lg shadow-purple-500/20'
                  : 'border-border bg-card hover:border-purple-500/50'
              )}
            >
              <div className="flex flex-col items-center gap-2">
                <div className={cn(
                  'rounded-lg p-2 transition-all duration-300',
                  scanMode === 'camera'
                    ? 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/30'
                    : 'bg-muted group-hover:bg-gradient-to-br group-hover:from-purple-500/20 group-hover:to-blue-500/20'
                )}>
                  <Camera className={cn(
                    'h-5 w-5 transition-colors',
                    scanMode === 'camera' ? 'text-white' : 'text-foreground'
                  )} />
                </div>
                <span className={cn(
                  'text-sm font-medium transition-colors',
                  scanMode === 'camera' ? 'text-purple-700 dark:text-purple-300' : 'text-muted-foreground'
                )}>
                  Camera
                </span>
              </div>
            </button>

            <button
              onClick={() => setScanMode('keyboard')}
              className={cn(
                'group relative overflow-hidden rounded-xl p-4 transition-all duration-300',
                'border-2 hover:scale-[1.02] hover:shadow-lg',
                scanMode === 'keyboard'
                  ? 'border-blue-500 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 shadow-lg shadow-blue-500/20'
                  : 'border-border bg-card hover:border-blue-500/50'
              )}
            >
              <div className="flex flex-col items-center gap-2">
                <div className={cn(
                  'rounded-lg p-2 transition-all duration-300',
                  scanMode === 'keyboard'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/30'
                    : 'bg-muted group-hover:bg-gradient-to-br group-hover:from-blue-500/20 group-hover:to-cyan-500/20'
                )}>
                  <Keyboard className={cn(
                    'h-5 w-5 transition-colors',
                    scanMode === 'keyboard' ? 'text-white' : 'text-foreground'
                  )} />
                </div>
                <span className={cn(
                  'text-sm font-medium transition-colors',
                  scanMode === 'keyboard' ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'
                )}>
                  Keyboard
                </span>
              </div>
            </button>

            <button
              onClick={() => setScanMode('bluetooth')}
              disabled={!isBluetoothSupported}
              className={cn(
                'group relative overflow-hidden rounded-xl p-4 transition-all duration-300',
                'border-2 hover:scale-[1.02] hover:shadow-lg',
                !isBluetoothSupported && 'opacity-50 cursor-not-allowed',
                scanMode === 'bluetooth'
                  ? 'border-emerald-500 bg-gradient-to-br from-green-500/20 to-emerald-500/20 shadow-lg shadow-emerald-500/20'
                  : 'border-border bg-card hover:border-emerald-500/50'
              )}
            >
              <div className="flex flex-col items-center gap-2">
                <div className={cn(
                  'rounded-lg p-2 transition-all duration-300',
                  scanMode === 'bluetooth'
                    ? 'bg-gradient-to-br from-green-500 to-emerald-500 shadow-lg shadow-emerald-500/30'
                    : 'bg-muted group-hover:bg-gradient-to-br group-hover:from-green-500/20 group-hover:to-emerald-500/20'
                )}>
                  <Bluetooth className={cn(
                    'h-5 w-5 transition-colors',
                    scanMode === 'bluetooth' ? 'text-white' : 'text-foreground'
                  )} />
                </div>
                <span className={cn(
                  'text-sm font-medium transition-colors',
                  scanMode === 'bluetooth' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'
                )}>
                  BLE
                </span>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

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