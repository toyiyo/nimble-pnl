import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.easyshifthq.employee',
  appName: 'EasyShiftHQ',
  webDir: 'dist',
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Scanning for Bluetooth devices...",
        cancel: "Cancel",
        availableDevices: "Available devices",
        noDeviceFound: "No device found"
      }
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    Camera: {}
  }
};

export default config;
