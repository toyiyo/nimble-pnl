import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { BleClient, BleDevice, ScanResult } from '@capacitor-community/bluetooth-le';

interface UseNativeBluetoothReturn {
  isNative: boolean;
  isScanning: boolean;
  devices: ScanResult[];
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (device: BleDevice) => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: boolean;
}

const SPP_SERVICE_UUID = '00001101-0000-1000-8000-00805f9b34fb';
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

export const useNativeBluetooth = (
  onScan: (data: string, format: string) => void,
  onError?: (error: string) => void
): UseNativeBluetoothReturn => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<ScanResult[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<BleDevice | null>(null);

  const isNative = Capacitor.isNativePlatform();

  const startScan = useCallback(async () => {
    if (!isNative) return;

    try {
      // Initialize BLE client
      await BleClient.initialize();

      setIsScanning(true);
      setDevices([]);

      // Start scanning for all devices (no service filter for broader compatibility)
      await BleClient.requestLEScan({}, (result) => {
        setDevices((prev) => {
          // Avoid duplicates
          const exists = prev.find((d) => d.device.deviceId === result.device.deviceId);
          if (exists) return prev;
          
          console.log('Found device:', result.device.name || result.device.deviceId);
          return [...prev, result];
        });
      });

      // Stop scanning after 10 seconds
      setTimeout(async () => {
        await stopScan();
      }, 10000);
    } catch (error) {
      console.error('Scan error:', error);
      onError?.(`Failed to start scan: ${error}`);
      setIsScanning(false);
    }
  }, [isNative, onError]);

  const stopScan = useCallback(async () => {
    if (!isNative) return;

    try {
      await BleClient.stopLEScan();
      setIsScanning(false);
    } catch (error) {
      console.error('Stop scan error:', error);
    }
  }, [isNative]);

  const connect = useCallback(async (device: BleDevice) => {
    if (!isNative) return;

    try {
      console.log('Connecting to device:', device.name || device.deviceId);
      
      // Connect to the device
      await BleClient.connect(device.deviceId, (deviceId) => {
        console.log('Device disconnected:', deviceId);
        setIsConnected(false);
        setConnectedDevice(null);
      });

      setIsConnected(true);
      setConnectedDevice(device);

      // Try to find and subscribe to notification characteristic
      try {
        // Try SPP service first
        const services = await BleClient.getServices(device.deviceId);
        console.log('Available services:', services);

        // Look for UART or SPP service
        let notifyChar = null;
        for (const service of services) {
          const characteristics = service.characteristics || [];
          for (const char of characteristics) {
            if (char.properties?.notify) {
              notifyChar = char;
              break;
            }
          }
          if (notifyChar) break;
        }

        if (notifyChar) {
          // Subscribe to notifications
          await BleClient.startNotifications(
            device.deviceId,
            notifyChar.service,
            notifyChar.uuid,
            (value) => {
              // Convert DataView to string
              const decoder = new TextDecoder();
              const data = decoder.decode(value);
              console.log('Received barcode data:', data);
              onScan(data.trim(), 'Bluetooth');
            }
          );
          console.log('Subscribed to notifications');
        } else {
          console.warn('No notification characteristic found');
        }
      } catch (error) {
        console.error('Service discovery error:', error);
        onError?.('Could not set up scanner notifications. Check scanner mode.');
      }
    } catch (error) {
      console.error('Connection error:', error);
      onError?.(`Failed to connect: ${error}`);
      setIsConnected(false);
    }
  }, [isNative, onScan, onError]);

  const disconnect = useCallback(async () => {
    if (!isNative || !connectedDevice) return;

    try {
      await BleClient.disconnect(connectedDevice.deviceId);
      setIsConnected(false);
      setConnectedDevice(null);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }, [isNative, connectedDevice]);

  return {
    isNative,
    isScanning,
    devices,
    startScan,
    stopScan,
    connect,
    disconnect,
    isConnected
  };
};
