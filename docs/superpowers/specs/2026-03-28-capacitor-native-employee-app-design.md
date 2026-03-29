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
- `@aparajita/capacitor-biometric-auth` — Face ID / fingerprint authentication (verified Capacitor 7.x compatible)
- `@capacitor/status-bar` — status bar styling to match app theme
- `@capacitor/preferences` — local device storage for biometric preference

### Build Scripts (package.json)
- `build:mobile` — `npm run build && npx cap sync`
- `build:ios` — `npm run build:mobile && npx cap open ios`
- `build:android` — `npm run build:mobile && npx cap open android`

### Vite Config
- Set `base: './'` in `vite.config.ts` — required for Capacitor's `file://` protocol (absolute paths like `/assets/chunk.js` fail on native). This is safe for web deployment too.

### Environment Variables
- Supabase URL and anon key are baked into the build via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Native builds use the same production `.env` values — no special handling needed
- Ensure `.env.local` (local dev) is NOT used for native builds — build scripts should use `.env.production`

## 2. Push Notifications

### Database
New table: `device_tokens`
- `id` (uuid, PK)
- `user_id` (uuid, FK to auth.users)
- `restaurant_id` (uuid, FK to restaurants)
- `token` (text, the device push token)
- `platform` (text: 'ios' | 'android')
- `created_at` (timestamptz)
- `updated_at` (timestamptz, with moddatetime trigger)
- `UNIQUE(user_id, token)` — prevents duplicate registrations on repeated app launches
- RLS: users can only read/write their own tokens

### Token Lifecycle
- On registration, upsert by `(user_id, token)` — if token exists, update `updated_at`
- When push send fails with "invalid token" error (APNs/FCM), delete the stale token
- Old tokens for the same user on different devices are kept (multi-device support)

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
- **Delivery mechanism: FCM HTTP v1 API for both iOS and Android** — iOS supports FCM via Firebase, so a single API handles both platforms. This avoids maintaining separate APNs JWT signing logic in Deno.
- FCM HTTP v1 call from Deno edge function: `POST https://fcm.googleapis.com/v1/projects/{project}/messages:send`
- Requires: Firebase project with Cloud Messaging enabled, service account key stored as Supabase secret
- On send failure with "NOT_FOUND" or "UNREGISTERED" error, delete the stale device token

### Notification Triggers

**Phase 1 (event-driven, ship with initial release):**
- Time-off request approved/denied — hook into existing edge function
- Schedule published/changed — hook into existing edge function
- New shift posted to marketplace — hook into existing edge function

**Phase 2 (time-based, requires pg_cron, deferred):**
- Shift reminder (30 min before shift start) — needs a pg_cron job that queries upcoming shifts and calls the push edge function
- Clock-in reminder if late — needs a pg_cron job that checks for missing punches after shift start time

Phase 2 triggers are significant backend infrastructure and should be implemented as a separate follow-up.

### Receiving Notifications
- `PushNotifications.addListener('pushNotificationReceived')` — handle foreground
- `PushNotifications.addListener('pushNotificationActionPerformed')` — handle tap (deep link to relevant page)

## 3. Biometric Authentication

### Flow
1. After first successful login, prompt: "Enable Face ID / Fingerprint for faster access?"
2. If accepted, store flag locally on device via `@capacitor/preferences` (biometric capability is device-specific — a user may have Face ID on iPhone but no biometrics on their Android tablet)
3. On app resume (from background), if biometrics enabled on this device:
   - Show a lock screen overlay (blocks UI)
   - Call `BiometricAuth.authenticate({ reason: 'Verify your identity' })`
   - On success: dismiss lock screen, show app content
   - On failure (3 attempts): sign out the Supabase session, redirect to login
4. New hook: `useBiometricAuth()` — manages enable/disable, verification on resume

### Session Security
- Supabase refresh token remains in WebView storage (standard Capacitor behavior)
- Biometric check is a UI gate — it prevents casual access if someone picks up an unlocked phone
- For higher security (e.g., financial apps), tokens could be moved to native Keychain/Keystore, but this is unnecessary for a scheduling app
- After 3 failed biometric attempts, the session is fully cleared (not just UI-blocked)

### Clock-In Enhancement
- Offer biometric verification as alternative to photo capture during clock-in
- Manager configures per-restaurant: require photo, biometric, or either

### Storage
- Biometric preference stored locally on device via `@capacitor/preferences` (device-specific, not synced)
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

### Time Punch Location Data
The `time_punches` table already has a `location` JSONB column storing `{ latitude, longitude }`. Extend this schema to include geofence data:
- `location` (jsonb) — `{ latitude, longitude, distance_meters, within_geofence }`
- No new column needed — extend the existing one
- Managers can see flagged entries in `TimePunchesManager.tsx` (timecard review)
- New utility: `src/lib/haversine.ts` — pure function for distance calculation (also usable server-side)

### Restaurant Settings UI
Add a section to restaurant settings (manager-only):
- Set restaurant coordinates (manual entry or "Use current location" button)
- Set geofence radius (slider, 50m–500m)
- Set enforcement mode (off/warn/block)

## 6. App Store Configuration

### App Identity
- **App name:** EasyShiftHQ
- **Bundle ID (iOS):** com.easyshifthq.employee
- **Package name (Android):** com.easyshifthq.employee
- **App ID in capacitor.config.ts:** Update from lovable default to `com.easyshifthq.employee`

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

- **Unit tests:** New hooks (`useDeviceToken`, `useBiometricAuth`, `useNativeCamera`, `useGeofenceCheck`), `haversine.ts` utility
- **Capacitor mocking:** All hooks that depend on Capacitor plugins will be tested with `vi.mock('@capacitor/core')` returning `isNativePlatform: false` and individual plugin mocks. Hooks should be structured so business logic is testable independently of the native bridge.
- **pgTAP tests:** `device_tokens` RLS policies, restaurant geofence columns, `time_punches.location` schema
- **Manual testing:** Native features require physical devices (push notifications don't work in simulators for iOS)
- **E2E:** Existing Playwright tests continue to pass (web experience unchanged)
