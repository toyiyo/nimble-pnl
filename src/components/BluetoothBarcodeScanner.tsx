import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bluetooth, BluetoothConnected, BluetoothSearching, Battery, Loader2, AlertCircle, Settings, Zap, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeGTIN, validateGTIN } from '@/lib/gtinUtils';

interface BluetoothBarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

interface BluetoothDevice {
  device: BluetoothDevice | null;
  characteristic: BluetoothRemoteGATTCharacteristic | null;
}

interface ScannerState {
  isConnecting: boolean;
  isConnected: boolean;
  device: BluetoothDevice;
  batteryLevel: number | null;
  scanMode: 'manual' | 'continuous' | 'auto-sensing';
  lastScan: string;
  scanCooldown: boolean;
  debugInfo: string;
}

const SPP_SERVICE_UUID = '00001101-0000-1000-8000-00805f9b34fb'; // ✅ Serial Port Profile
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'; // ✅ Nordic UART Service
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';

export const BluetoothBarcodeScanner: React.FC<BluetoothBarcodeScannerProps> = ({
  onScan,
  onError,
  className,
  autoStart = false
}) => {
  const [state, setState] = useState<ScannerState>({
    isConnecting: false,
    isConnected: false,
    device: { device: null, characteristic: null },
    batteryLevel: null,
    scanMode: 'manual',
    lastScan: '',
    scanCooldown: false,
    debugInfo: 'Ready to connect'
  });

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check Web Bluetooth API support
  const isBluetoothSupported = useCallback(() => {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }, []);

  // Handle barcode data from Bluetooth device
  const handleBluetoothData = useCallback((data: string) => {
    const cleanedData = data.trim();
    
    // Basic validation for barcode format
    if (cleanedData.length >= 8 && /^\d+$/.test(cleanedData)) {
      if (cleanedData !== state.lastScan && !state.scanCooldown) {
        // Normalize GTIN with proper check digit calculation
        const normalizedGtin = normalizeGTIN(cleanedData);
        
        // Log validation result for debugging
        const isValid = validateGTIN(normalizedGtin);
        if (!isValid) {
          console.warn(`⚠️ Generated GTIN may have invalid check digit: ${normalizedGtin}`);
        }
        
        onScan(normalizedGtin, 'Bluetooth');
        
        setState(prev => ({
          ...prev,
          lastScan: cleanedData,
          scanCooldown: true,
          debugInfo: `Scanned: ${cleanedData}`
        }));

        // Reset cooldown after 1 second
        setTimeout(() => {
          setState(prev => ({ ...prev, scanCooldown: false }));
        }, 1000);
      }
    }
  }, [state.lastScan, state.scanCooldown, onScan]);

  // Connect to Bluetooth scanner
  const connectToScanner = useCallback(async () => {
    if (!isBluetoothSupported()) {
      onError?.('Web Bluetooth API is not supported in this browser');
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, debugInfo: 'Searching for devices...' }));

    try {
      // Request device with multiple service filters
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [SPP_SERVICE_UUID, UART_SERVICE_UUID] },
          { namePrefix: 'NT-1228' },
          { namePrefix: 'Scanner' },
          { namePrefix: 'Barcode' }
        ],
        optionalServices: [BATTERY_SERVICE_UUID, SPP_SERVICE_UUID, UART_SERVICE_UUID]
      });

      setState(prev => ({ ...prev, debugInfo: 'Connecting to device...' }));

      // Connect to GATT server
      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Failed to connect to GATT server');
      }

      setState(prev => ({ ...prev, debugInfo: 'Getting services...' }));

      // Try to get HID service for data
      let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
      
      try {
        const hidService = await server.getPrimaryService(SPP_SERVICE_UUID);
        const characteristics = await hidService.getCharacteristics();
        
        // Find a characteristic that supports notifications
        for (const char of characteristics) {
          if (char.properties.notify) {
            characteristic = char;
            break;
          }
        }
      } catch (error) {
        console.warn('HID service not available, trying alternative approach');
      }

      // Verify we have a working characteristic
      if (!characteristic) {
        throw new Error('Scanner does not support data notifications. Please check scanner mode (HID/SPP/BLE).');
      }

      // Set up battery monitoring if available
      try {
        const batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
        const batteryChar = await batteryService.getCharacteristic('00002a19-0000-1000-8000-00805f9b34fb');
        const batteryValue = await batteryChar.readValue();
        const batteryLevel = batteryValue.getUint8(0);
        
        setState(prev => ({ ...prev, batteryLevel }));
      } catch (error) {
        console.warn('Battery service not available');
      }

      // Set up data notifications
      if (characteristic) {
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          const value = target.value;
          if (value) {
            const decoder = new TextDecoder();
            const data = decoder.decode(value);
            handleBluetoothData(data);
          }
        });
      }

      // Handle device disconnection
      device.addEventListener('gattserverdisconnected', () => {
        setState(prev => ({
          ...prev,
          isConnected: false,
          device: { device: null, characteristic: null },
          debugInfo: 'Device disconnected'
        }));
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectToScanner();
        }, 3000);
      });

      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        device: { device, characteristic },
        debugInfo: `Connected to ${device.name || 'Scanner'}`
      }));

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: false,
        debugInfo: `Connection failed: ${errorMessage}`
      }));
      onError?.(errorMessage);
    }
  }, [isBluetoothSupported, onError, handleBluetoothData]);

  // Disconnect from scanner
  const disconnectScanner = useCallback(() => {
    const currentDevice = state.device.device;
    if (currentDevice?.gatt?.connected) {
      currentDevice.gatt.disconnect();
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setState(prev => ({
      ...prev,
      isConnected: false,
      device: { device: null, characteristic: null },
      batteryLevel: null,
      debugInfo: 'Disconnected'
    }));
  }, [state.device.device]);

  // Auto-start connection if requested
  useEffect(() => {
    if (autoStart && isBluetoothSupported()) {
      connectToScanner();
    }
  }, [autoStart, connectToScanner, isBluetoothSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectScanner();
    };
  }, [disconnectScanner]);

  if (!isBluetoothSupported()) {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            Bluetooth Not Supported
          </CardTitle>
          <CardDescription>
            Web Bluetooth API is not supported in this browser. Please use Chrome, Edge, or another compatible browser.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {state.isConnected ? (
              <BluetoothConnected className="h-5 w-5 text-blue-500" />
            ) : state.isConnecting ? (
              <BluetoothSearching className="h-5 w-5 text-blue-500 animate-pulse" />
            ) : (
              <Bluetooth className="h-5 w-5 text-gray-500" />
            )}
            Bluetooth Scanner
          </div>
          <div className="flex items-center gap-2">
            {state.batteryLevel !== null && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Battery className="h-3 w-3" />
                {state.batteryLevel}%
              </Badge>
            )}
            {state.isConnected && (
              <Badge variant="default" className="bg-green-500">
                Connected
              </Badge>
            )}
          </div>
        </CardTitle>
        <CardDescription>
          {state.debugInfo}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Connection area */}
        <div className="min-h-[200px] border-2 border-dashed rounded-lg flex items-center justify-center relative">
          {state.isConnected ? (
            <div className="text-center space-y-4">
              <div className="text-6xl">📱</div>
              <div className="text-lg font-medium text-green-600">
                Scanner Ready
              </div>
              <div className="text-sm text-muted-foreground">
                Use your scanner to scan barcodes
              </div>
              {state.scanCooldown && (
                <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-sm">
                  Scanned! ✓
                </div>
              )}
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="text-6xl opacity-50">🔍</div>
              <div className="text-lg font-medium text-muted-foreground">
                {state.isConnecting ? 'Connecting...' : 'Not Connected'}
              </div>
              <div className="text-sm text-muted-foreground">
                Click connect to pair with your Bluetooth scanner
              </div>
            </div>
          )}
        </div>

        {/* Control buttons */}
        <div className="flex gap-2">
          {!state.isConnected ? (
            <Button
              onClick={connectToScanner}
              disabled={state.isConnecting}
              className="flex-1"
            >
              {state.isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Bluetooth className="h-4 w-4 mr-2" />
                  Connect Scanner
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={disconnectScanner}
              variant="outline"
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Disconnect
            </Button>
          )}
        </div>

        {/* Scanner mode selector (if connected) */}
        {state.isConnected && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Scanner Mode:</div>
            <div className="grid grid-cols-3 gap-1 bg-muted p-1 rounded-lg">
              <Button
                variant={state.scanMode === 'manual' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setState(prev => ({ ...prev, scanMode: 'manual' }))}
                className="text-xs"
              >
                Manual
              </Button>
              <Button
                variant={state.scanMode === 'continuous' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setState(prev => ({ ...prev, scanMode: 'continuous' }))}
                className="text-xs"
              >
                Continuous
              </Button>
              <Button
                variant={state.scanMode === 'auto-sensing' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setState(prev => ({ ...prev, scanMode: 'auto-sensing' }))}
                className="text-xs"
              >
                Auto-Sense
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
