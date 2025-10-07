# Mobile Bluetooth Scanner Setup Guide

Your app now has **native Bluetooth support** for Android and iOS! This bypasses Web Bluetooth API limitations and gives you full access to all Bluetooth devices.

## 🚀 Quick Setup

### 1. Export Your Project
Click the **"Export to Github"** button in Lovable to transfer your project to your own Github repository.

### 2. Clone and Install
```bash
git clone <your-github-repo-url>
cd <your-project>
npm install
```

### 3. Add Native Platforms
```bash
# For Android
npx cap add android

# For iOS (Mac with Xcode required)
npx cap add ios
```

### 4. Update Native Dependencies
```bash
# Update based on your platform
npx cap update android
# OR
npx cap update ios
```

### 5. Build the Web App
```bash
npm run build
```

### 6. Sync with Native Platforms
```bash
npx cap sync
```

### 7. Run on Device
```bash
# For Android (requires Android Studio)
npx cap run android

# For iOS (requires Mac + Xcode)
npx cap run ios
```

## 📱 Testing on Your Device

1. Make sure your Bluetooth scanner is in **pairing mode** (refer to your scanner's manual)
2. Open the app on your physical device
3. Navigate to the Inventory page
4. Click the **"Bluetooth Scanner"** tab
5. Click **"Connect Scanner"**
6. You should now see **all available Bluetooth devices** including your scanner!
7. Tap your scanner device to connect
8. Start scanning barcodes!

## ✅ What Changed

- ✅ **Native Bluetooth** replaces Web Bluetooth API on mobile
- ✅ **All devices visible** - no more "Unknown or Unsupported Device" issues
- ✅ **Better compatibility** with Android barcode scanners
- ✅ **Works with Bluetooth Classic and BLE** devices

## 🔧 Permissions

The app will automatically request Bluetooth permissions when you try to scan. Make sure to grant them!

### Android Permissions (automatically added)
- `BLUETOOTH_SCAN`
- `BLUETOOTH_CONNECT`
- `ACCESS_FINE_LOCATION` (required for Bluetooth on Android)

### iOS Permissions (automatically added)
- `NSBluetoothAlwaysUsageDescription`

## 🌐 Development Server

For development with hot-reload, the Capacitor config is set to load from:
```
https://e67913e6-55e2-4c9f-9e7f-3f0b0f6d1da6.lovableproject.com
```

This means you can make changes in Lovable and see them live on your device without rebuilding!

## 📚 Next Steps

After pulling new changes from Github:
```bash
git pull
npm install
npx cap sync  # Sync changes to native platforms
```

## 🆘 Troubleshooting

### Scanner Not Appearing?
- Make sure the scanner is in pairing mode
- Try turning Bluetooth off/on on your phone
- Check that location services are enabled (Android requirement)

### Can't Build?
- Make sure Android Studio is installed (for Android)
- Make sure Xcode is installed (for iOS, Mac only)
- Run `npm install` again

### Connection Issues?
- Some scanners need to be in a specific mode (HID/SPP/BLE)
- Check your scanner's manual for the correct mode
- Try unpairing the device from phone settings first

## 📖 Learn More

Read the full guide on running apps on physical devices:
https://lovable.dev/blogs/TODO

---

**Note:** The web version will continue to use Web Bluetooth API, which has browser limitations. For the best experience with barcode scanners, use the native mobile app!
