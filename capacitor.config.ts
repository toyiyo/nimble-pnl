import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.easyshifthq.employee',
  appName: 'EasyShiftHQ',
  webDir: 'dist',
  ios: {
    // Allow WebView to be transparent so ML Kit camera preview shows through
    backgroundColor: '#ffffff',
  },
  android: {
    // Don't overlay WebView behind status bar — prevents untouchable top area
    backgroundColor: '#ffffff',
  },
  plugins: {
    StatusBar: {
      // Show status bar above WebView content, not overlaying it
      overlaysWebView: false,
    },
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
