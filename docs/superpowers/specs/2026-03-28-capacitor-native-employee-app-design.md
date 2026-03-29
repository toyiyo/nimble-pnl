# Capacitor Native Employee App — Design Spec

**Date:** 2026-03-28
**Status:** Draft
**Goal:** Wrap the existing employee mobile web experience as a native iOS/Android app using Capacitor, adding push notifications, biometric auth, enhanced camera, and geofenced clock-in.

## Context

EasyShiftHQ already has a fully built mobile employee experience:
- 9 employee pages (Clock, Schedule, Pay, Timecard, Tips, Shifts, Portal, More, Settings)
- MobileLayout + MobileTabBar with bottom navigation
- PWA manifest configured (standalone mode)
- Safe area inset handling
- Capacitor 7.4.3 already installed with core, CLI, iOS, and Android packages

The native platforms (ios/, android/) have not been generated. Only the BluetoothLE plugin is currently in use.

## Approach

Use Capacitor to wrap the existing React web app as native iOS and Android apps. This reuses ~95-100% of existing code. No UI rewrite needed.

## 1. Project Structure & Build Setup

### Capacitor Config Changes
Update `capacitor.config.ts`:
- Remove the remote `server.url` (currently points to a lovable project URL) — app should load from local `dist/` bundle
- Add plugin configurations for PushNotifications, Camera, Geolocation
- Keep existing BluetoothLe config

### Native Platform Generation
- Run `npx cap add ios` and `npx cap add android` to generate native projects
- Add `ios/` and `android/` to the repository (standard Capacitor practice)
- Configure app icons and splash screens in native projects

### New Dependencies
- `@capacitor/push-notifications` — push notification registration and handling
- `@capacitor/camera` — native camera access for clock-in photos
- `@capacitor/geolocation` — location for geofenced clock-in
- `@capacitor-community/biometrics` — Face ID / fingerprint authentication

### Build Scripts (package.json)
- `build:mobile` — `npm run build && npx cap sync`
- `build:ios` — `npm run build:mobile && npx cap open ios`
- `build:android` — `npm run build:mobile && npx cap open android`

### Vite Config
- Ensure base path works with Capacitor's `file://` protocol (may need `base: './'` or conditionally set based on build target)

## 2. Push Notifications

### Database
New table: `device_tokens`
- `id` (uuid, PK)
- `user_id` (uuid, FK to auth.users)
- `restaurant_id` (uuid, FK to restaurants)
- `token` (text, the device push token)
- `platform` (text: 'ios' | 'android')
- `created_at` (timestamptz)
- `updated_at` (timestamptz)
- RLS: users can only read/write their own tokens

### Registration Flow
1. On app launch (native only), call `PushNotifications.requestPermissions()`
2. On permission granted, call `PushNotifications.register()`
3. Listen for `registration` event to get the device token
4. Upsert token to `device_tokens` table via Supabase client
5. New hook: `useDeviceToken()` — handles registration lifecycle

### Sending Notifications
New edge function: `send-push-notification`
- Accepts: `user_id`, `title`, `body`, `data` (optional deep link info)
- Looks up device tokens for the user
- Sends via APNs (iOS) and FCM (Android)
- Requires: APNs key (Apple Developer), FCM server key (Firebase project)

### Notification Triggers
Integrate into existing business logic edge functions:
- Shift reminder (30 min before shift start)
- Time-off request approved/denied
- New shift posted to marketplace
- Schedule published/changed
- Clock-in reminder if late

### Receiving Notifications
- `PushNotifications.addListener('pushNotificationReceived')` — handle foreground
- `PushNotifications.addListener('pushNotificationActionPerformed')` — handle tap (deep link to relevant page)

## 3. Biometric Authentication

### Flow
1. After first successful login, prompt: "Enable Face ID / Fingerprint for faster access?"
2. If accepted, store flag in Supabase user metadata (`biometrics_enabled: true`)
3. On app resume (from background), if biometrics enabled:
   - Call `BiometricAuth.authenticate({ reason: 'Verify your identity' })`
   - On success: show app content
   - On failure: fall back to email/password login
4. New hook: `useBiometricAuth()` — manages enable/disable, verification on resume

### Clock-In Enhancement
- Offer biometric verification as alternative to photo capture during clock-in
- Manager configures per-restaurant: require photo, biometric, or either

### Storage
- Biometric preference stored in Supabase user metadata (syncs across devices)
- No biometric data is stored — only the preference flag; the OS handles actual biometric matching

## 4. Enhanced Camera

### Conditional Native Camera
Update `ImageCapture.tsx` (or create a wrapper hook `useNativeCamera()`):
```
if (Capacitor.isNativePlatform()) {
  // Use @capacitor/camera for reliable native capture
  const photo = await Camera.getPhoto({ quality: 80, source: CameraSource.Camera });
} else {
  // Existing web Camera API fallback
}
```

### Benefits Over Web Camera
- More reliable on iOS (Safari camera issues)
- Better permission handling
- Access to native photo picker if needed
- Consistent behavior across devices

### No UI Changes
- Same clock-in photo flow — just a more reliable capture mechanism underneath
- Web/PWA users continue using existing web camera code

## 5. Geofenced Clock-In

### Database Changes
Add columns to `restaurants` table:
- `latitude` (numeric, nullable)
- `longitude` (numeric, nullable)
- `geofence_radius_meters` (integer, default 200)
- `geofence_enforcement` (text: 'off' | 'warn' | 'block', default 'off')

### Clock-In Flow
1. Employee taps "Clock In"
2. If restaurant has geofence configured and enforcement != 'off':
   - Call `Geolocation.getCurrentPosition()`
   - Calculate distance to restaurant coordinates (Haversine formula)
   - If within radius: proceed normally
   - If outside radius + enforcement = 'warn': show warning, allow clock-in, flag the entry
   - If outside radius + enforcement = 'block': deny clock-in with message
3. New hook: `useGeofenceCheck(restaurantId)` — returns `{ checkLocation, isWithinGeofence, distance }`

### Time Entry Flagging
Add column to `time_entries` table:
- `clock_in_location` (jsonb, nullable) — `{ lat, lng, distance_meters, within_geofence }`
- Managers can see flagged entries in timecard review

### Restaurant Settings UI
Add a section to restaurant settings (manager-only):
- Set restaurant coordinates (manual entry or "Use current location" button)
- Set geofence radius (slider, 50m–500m)
- Set enforcement mode (off/warn/block)

## 6. App Store Configuration

### App Identity
- **App name:** EasyShiftHQ
- **Bundle ID (iOS):** com.easyshifthq.app
- **Package name (Android):** com.easyshifthq.app
- **App ID in capacitor.config.ts:** Update from lovable default to `com.easyshifthq.app`

### Required Accounts (Manual, Not Part of Implementation)
- Apple Developer Program ($99/year) — for App Store + APNs
- Google Play Developer Console ($25 one-time) — for Play Store + FCM
- Firebase project — for FCM server key

### Native Permissions
**iOS (Info.plist):**
- `NSCameraUsageDescription` — "Used for clock-in photo verification"
- `NSLocationWhenInUseUsageDescription` — "Used to verify you're at the restaurant when clocking in"
- `NSFaceIDUsageDescription` — "Used for quick, secure login"

**Android (AndroidManifest.xml):**
- `android.permission.CAMERA`
- `android.permission.ACCESS_FINE_LOCATION`
- `android.permission.USE_BIOMETRIC`
- `android.permission.RECEIVE_BOOT_COMPLETED` (for push)
- `android.permission.INTERNET`

### Icons & Splash Screens
- Use existing EasyShiftHQ branding
- Generate all required sizes using `@capacitor/assets` or similar tool
- Splash screen: simple logo on background color

## 7. What's NOT in Scope

- **App Store submission process** — requires manual account setup and review
- **Offline support** — all data fetches require internet
- **Manager/owner mobile experience** — stays web-only
- **New employee pages or UI changes** — existing pages used as-is
- **Web push notifications** — native-only feature
- **Background location tracking** — only check location at clock-in time
- **Custom URL scheme deep links** — deferred to future iteration

## 8. Testing Strategy

- **Unit tests:** New hooks (`useDeviceToken`, `useBiometricAuth`, `useNativeCamera`, `useGeofenceCheck`)
- **pgTAP tests:** `device_tokens` RLS policies, restaurant geofence columns, time entry location column
- **Manual testing:** Native features require physical devices (push notifications don't work in simulators for iOS)
- **E2E:** Existing Playwright tests continue to pass (web experience unchanged)
