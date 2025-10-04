import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.e67913e655e24c9f9e7f3f0b0f6d1da6',
  appName: 'easyshifthq',
  webDir: 'dist',
  server: {
    url: 'https://e67913e6-55e2-4c9f-9e7f-3f0b0f6d1da6.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Scanning for Bluetooth devices...",
        cancel: "Cancel",
        availableDevices: "Available devices",
        noDeviceFound: "No device found"
      }
    }
  }
};

export default config;
