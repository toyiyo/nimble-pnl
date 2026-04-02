# Capacitor Native Employee App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing employee mobile web experience as a native iOS/Android app with push notifications, biometric auth, enhanced camera, and geofenced clock-in.

**Architecture:** Capacitor wraps the existing React SPA in a native WebView. New Capacitor plugins provide native features (push, biometrics, camera, geolocation). Same Supabase backend, same React UI. New hooks abstract plugin access behind `Capacitor.isNativePlatform()` guards so web/PWA continues working unchanged.

**Tech Stack:** Capacitor 7.4.3, React 18, TypeScript, Supabase (PostgreSQL + Edge Functions), FCM HTTP v1, Vitest, pgTAP

**Spec:** `docs/superpowers/specs/2026-03-28-capacitor-native-employee-app-design.md`

---

## File Map

### New Files
- `src/lib/haversine.ts` — pure distance calculation utility
- `src/hooks/useDeviceToken.ts` — push notification token registration
- `src/hooks/useBiometricAuth.ts` — biometric enable/disable + app resume verification
- `src/hooks/useNativeCamera.ts` — Capacitor camera with web fallback
- `src/hooks/useGeofenceCheck.ts` — location check against restaurant coordinates
- `src/components/BiometricLockScreen.tsx` — overlay shown on app resume
- `src/components/settings/GeofenceSettings.tsx` — restaurant geofence config UI
- `supabase/functions/send-push-notification/index.ts` — FCM delivery edge function
- `supabase/migrations/XXXXXX_create_device_tokens.sql` — device_tokens table + RLS
- `supabase/migrations/XXXXXX_add_restaurant_geofence.sql` — geofence columns on restaurants
- `tests/unit/haversine.test.ts` — haversine utility tests
- `tests/unit/useDeviceToken.test.ts` — device token hook tests
- `tests/unit/useBiometricAuth.test.ts` — biometric auth hook tests
- `tests/unit/useNativeCamera.test.ts` — native camera hook tests
- `tests/unit/useGeofenceCheck.test.ts` — geofence check hook tests
- `supabase/tests/device_tokens.test.sql` — pgTAP tests for device_tokens table
- `supabase/tests/restaurant_geofence.test.sql` — pgTAP tests for geofence columns

### Modified Files
- `capacitor.config.ts` — update appId, remove server.url, add plugin configs
- `vite.config.ts` — add `base: './'`
- `package.json` — add dependencies + build scripts
- `src/components/ImageCapture.tsx` — integrate native camera fallback
- `src/pages/EmployeeClock.tsx` — integrate geofence check + biometric clock-in option
- `src/utils/punchContext.ts` — extend location data with geofence fields
- `src/pages/RestaurantSettings.tsx` — add geofence settings section
- `src/components/employee/MobileLayout.tsx` — integrate biometric lock screen
- `supabase/functions/send-time-off-notification/index.ts` — add push notification call
- `supabase/functions/notify-schedule-published/index.ts` — add push notification call
- `supabase/functions/send-shift-trade-notification/index.ts` — add push notification call

---

## Task 1: Capacitor Project Setup & Build Config

**Files:**
- Modify: `capacitor.config.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Update capacitor.config.ts**

Replace the current config. Remove the remote `server.url`, update `appId`, add plugin configs:

```typescript
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
    Camera: {
      // iOS camera permissions configured in Info.plist
    }
  }
};

export default config;
```

- [ ] **Step 2: Set Vite base path**

In `vite.config.ts`, add `base: './'` to the returned config object (required for Capacitor `file://` protocol). The existing config uses `async ({ mode }) => { ... return { ... } }` — add `base: './'` inside the returned object alongside the existing `plugins`, `resolve`, `build` keys.

- [ ] **Step 3: Install Capacitor plugins**

Run:
```bash
npm install @capacitor/push-notifications @capacitor/camera @capacitor/geolocation @capacitor/status-bar @capacitor/preferences @aparajita/capacitor-biometric-auth
```

- [ ] **Step 4: Add build scripts to package.json**

Add to `scripts`:
```json
{
  "build:mobile": "npm run build && npx cap sync",
  "build:ios": "npm run build:mobile && npx cap open ios",
  "build:android": "npm run build:mobile && npx cap open android"
}
```

- [ ] **Step 5: Generate native platforms**

Run:
```bash
npx cap add ios
npx cap add android
```

Expected: `ios/` and `android/` directories created.

- [ ] **Step 6: Build and sync**

Run: `npm run build:mobile`
Expected: Build succeeds, `npx cap sync` copies `dist/` to native projects.

- [ ] **Step 7: Verify existing tests still pass**

Run: `npm run test`
Expected: All existing tests pass (no regressions from config changes).

- [ ] **Step 8: Commit**

```bash
git add capacitor.config.ts vite.config.ts package.json package-lock.json ios/ android/
git commit -m "feat: configure Capacitor native app with iOS and Android platforms"
```

---

## Task 2: Haversine Distance Utility

**Files:**
- Create: `src/lib/haversine.ts`
- Create: `tests/unit/haversine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/haversine.test.ts
import { describe, it, expect } from 'vitest';
import { haversineDistance, isWithinRadius } from '@/lib/haversine';

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it('calculates distance between NYC and LA (~3944 km)', () => {
    const distance = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(3900000);
    expect(distance).toBeLessThan(4000000);
  });

  it('calculates short distance (~111 m for 0.001 degree latitude)', () => {
    const distance = haversineDistance(40.0, -74.0, 40.001, -74.0);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe('isWithinRadius', () => {
  it('returns true when within radius', () => {
    expect(isWithinRadius(40.7128, -74.006, 40.7129, -74.0061, 200)).toBe(true);
  });

  it('returns false when outside radius', () => {
    expect(isWithinRadius(40.7128, -74.006, 40.72, -74.006, 200)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/haversine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/haversine.ts
const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Returns distance in meters between two lat/lng points */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Returns true if the point is within radiusMeters of the target */
export function isWithinRadius(
  pointLat: number, pointLng: number,
  targetLat: number, targetLng: number,
  radiusMeters: number
): boolean {
  return haversineDistance(pointLat, pointLng, targetLat, targetLng) <= radiusMeters;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/haversine.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/haversine.ts tests/unit/haversine.test.ts
git commit -m "feat: add haversine distance utility for geofence calculations"
```

---

## Task 3: Database — device_tokens Table

**Files:**
- Create: `supabase/migrations/XXXXXX_create_device_tokens.sql`
- Create: `supabase/tests/device_tokens.test.sql`

- [ ] **Step 1: Write pgTAP tests**

```sql
-- supabase/tests/device_tokens.test.sql
BEGIN;
SELECT plan(6);

-- Table exists
SELECT has_table('public', 'device_tokens', 'device_tokens table exists');

-- Required columns
SELECT has_column('public', 'device_tokens', 'user_id', 'has user_id column');
SELECT has_column('public', 'device_tokens', 'token', 'has token column');
SELECT has_column('public', 'device_tokens', 'platform', 'has platform column');
SELECT has_column('public', 'device_tokens', 'restaurant_id', 'has restaurant_id column');

-- Unique constraint exists
SELECT has_unique('public', 'device_tokens', 'device_tokens has unique constraint');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run pgTAP tests to verify they fail**

Run: `npm run test:db`
Expected: FAIL — table does not exist

- [ ] **Step 3: Write the migration**

Generate timestamp with: `date +%Y%m%d%H%M%S`

```sql
-- supabase/migrations/XXXXXX_create_device_tokens.sql
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, token)
);

-- Index for looking up tokens by user
CREATE INDEX idx_device_tokens_user_id ON public.device_tokens(user_id);

-- Auto-update updated_at (uses existing project trigger function)
CREATE TRIGGER update_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own device tokens"
  ON public.device_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 4: Reset database and run pgTAP tests**

Run: `npm run db:reset && npm run test:db`
Expected: All device_tokens tests PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_create_device_tokens.sql supabase/tests/device_tokens.test.sql
git commit -m "feat: add device_tokens table for push notification registration"
```

---

## Task 4: Database — Restaurant Geofence Columns

**Files:**
- Create: `supabase/migrations/XXXXXX_add_restaurant_geofence.sql`
- Create: `supabase/tests/restaurant_geofence.test.sql`

- [ ] **Step 1: Write pgTAP tests**

```sql
-- supabase/tests/restaurant_geofence.test.sql
BEGIN;
SELECT plan(4);

SELECT has_column('public', 'restaurants', 'latitude', 'has latitude column');
SELECT has_column('public', 'restaurants', 'longitude', 'has longitude column');
SELECT has_column('public', 'restaurants', 'geofence_radius_meters', 'has geofence_radius_meters column');
SELECT has_column('public', 'restaurants', 'geofence_enforcement', 'has geofence_enforcement column');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run pgTAP tests to verify they fail**

Run: `npm run test:db`
Expected: FAIL — columns do not exist

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/XXXXXX_add_restaurant_geofence.sql
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS geofence_enforcement text NOT NULL DEFAULT 'off'
    CHECK (geofence_enforcement IN ('off', 'warn', 'block'));
```

- [ ] **Step 4: Reset database and run pgTAP tests**

Run: `npm run db:reset && npm run test:db`
Expected: All restaurant geofence tests PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_add_restaurant_geofence.sql supabase/tests/restaurant_geofence.test.sql
git commit -m "feat: add geofence columns to restaurants table"
```

---

## Task 5: Push Notification — useDeviceToken Hook

**Files:**
- Create: `src/hooks/useDeviceToken.ts`
- Create: `tests/unit/useDeviceToken.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/useDeviceToken.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Capacitor before importing hook
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn(),
    removeAllListeners: vi.fn(),
  }
}));

import { shouldRegisterForPush } from '@/hooks/useDeviceToken';

describe('useDeviceToken', () => {
  it('shouldRegisterForPush returns false on web', () => {
    expect(shouldRegisterForPush(false)).toBe(false);
  });

  it('shouldRegisterForPush returns true on native with user', () => {
    expect(shouldRegisterForPush(true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useDeviceToken.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/hooks/useDeviceToken.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

/** Testable helper: should we register for push? */
export function shouldRegisterForPush(isNative: boolean): boolean {
  return isNative;
}

export function useDeviceToken() {
  const { user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!shouldRegisterForPush(isNative) || !user || !selectedRestaurant) return;

    const registerToken = async () => {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') return;

      await PushNotifications.register();

      PushNotifications.addListener('registration', async ({ value: token }) => {
        const platform = Capacitor.getPlatform() as 'ios' | 'android';
        await supabase.from('device_tokens').upsert(
          {
            user_id: user.id,
            restaurant_id: selectedRestaurant.id,
            token,
            platform,
          },
          { onConflict: 'user_id,token' }
        );
      });
    };

    registerToken();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [isNative, user, selectedRestaurant]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useDeviceToken.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDeviceToken.ts tests/unit/useDeviceToken.test.ts
git commit -m "feat: add useDeviceToken hook for push notification registration"
```

---

## Task 6: Push Notification — Edge Function

**Files:**
- Create: `supabase/functions/send-push-notification/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/send-push-notification/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface PushRequest {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(serviceAccount: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '')), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = base64url(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`))
  )));

  const jwtToken = `${header}.${claim}.${signature}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`,
  });

  const { access_token } = await tokenRes.json();
  return access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Internal-only: verify service role key in Authorization header
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey
  );

  const { user_id, title, body, data } = await req.json() as PushRequest;

  // Look up device tokens
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('id, token, platform')
    .eq('user_id', user_id);

  if (error || !tokens?.length) {
    return new Response(
      JSON.stringify({ sent: 0, reason: error?.message || 'no tokens' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get FCM access token
  const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!);
  const accessToken = await getAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;

  let sent = 0;
  const staleTokenIds: string[] = [];

  for (const deviceToken of tokens) {
    const message = {
      message: {
        token: deviceToken.token,
        notification: { title, body },
        ...(data ? { data } : {}),
      },
    };

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    if (res.ok) {
      sent++;
    } else {
      const err = await res.json();
      const errorCode = err?.error?.details?.[0]?.errorCode;
      if (errorCode === 'NOT_FOUND' || errorCode === 'UNREGISTERED') {
        staleTokenIds.push(deviceToken.id);
      }
    }
  }

  // Clean up stale tokens
  if (staleTokenIds.length > 0) {
    await supabase.from('device_tokens').delete().in('id', staleTokenIds);
  }

  return new Response(
    JSON.stringify({ sent, cleaned: staleTokenIds.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-push-notification/
git commit -m "feat: add send-push-notification edge function with FCM v1"
```

---

## Task 7: Biometric Auth — useBiometricAuth Hook + Lock Screen

**Files:**
- Create: `src/hooks/useBiometricAuth.ts`
- Create: `src/components/BiometricLockScreen.tsx`
- Create: `tests/unit/useBiometricAuth.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/useBiometricAuth.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: vi.fn().mockResolvedValue({ isAvailable: false }),
    authenticate: vi.fn(),
  }
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn(),
    remove: vi.fn(),
  }
}));

import { isBiometricSupported } from '@/hooks/useBiometricAuth';

describe('useBiometricAuth', () => {
  it('returns false when not native', () => {
    expect(isBiometricSupported(false, false)).toBe(false);
  });

  it('returns false when native but hardware unavailable', () => {
    expect(isBiometricSupported(true, false)).toBe(false);
  });

  it('returns true when native and hardware available', () => {
    expect(isBiometricSupported(true, true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useBiometricAuth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the hook**

```typescript
// src/hooks/useBiometricAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { Preferences } from '@capacitor/preferences';

const BIOMETRIC_ENABLED_KEY = 'biometric_auth_enabled';
const MAX_ATTEMPTS = 3;

/** Testable helper */
export function isBiometricSupported(isNative: boolean, hardwareAvailable: boolean): boolean {
  return isNative && hardwareAvailable;
}

export function useBiometricAuth() {
  const isNative = Capacitor.isNativePlatform();
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    if (!isNative) return;
    BiometricAuth.checkBiometry().then(({ isAvailable: available }) => {
      setIsAvailable(available);
    });
    Preferences.get({ key: BIOMETRIC_ENABLED_KEY }).then(({ value }) => {
      setIsEnabled(value === 'true');
    });
  }, [isNative]);

  const enable = useCallback(async () => {
    await Preferences.set({ key: BIOMETRIC_ENABLED_KEY, value: 'true' });
    setIsEnabled(true);
  }, []);

  const disable = useCallback(async () => {
    await Preferences.remove({ key: BIOMETRIC_ENABLED_KEY });
    setIsEnabled(false);
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      await BiometricAuth.authenticate({ reason: 'Verify your identity' });
      setIsLocked(false);
      setFailedAttempts(0);
      return true;
    } catch {
      let shouldSignOut = false;
      setFailedAttempts(prev => {
        const next = prev + 1;
        if (next >= MAX_ATTEMPTS) shouldSignOut = true;
        return next;
      });
      return false;
    }
  }, []);

  const lock = useCallback(() => setIsLocked(true), []);
  const shouldSignOut = failedAttempts >= MAX_ATTEMPTS;

  return {
    isAvailable: isBiometricSupported(isNative, isAvailable),
    isEnabled,
    isLocked,
    shouldSignOut,
    failedAttempts,
    enable,
    disable,
    authenticate,
    lock,
  };
}
```

- [ ] **Step 4: Write the lock screen component**

```typescript
// src/components/BiometricLockScreen.tsx
import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BiometricLockScreenProps {
  onAuthenticate: () => Promise<boolean>;
  failedAttempts: number;
}

export function BiometricLockScreen({ onAuthenticate, failedAttempts }: BiometricLockScreenProps) {
  const onAuthRef = useRef(onAuthenticate);
  onAuthRef.current = onAuthenticate;

  useEffect(() => {
    onAuthRef.current();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center">
        <ShieldCheck className="h-8 w-8 text-foreground" />
      </div>
      <div className="text-center">
        <h1 className="text-[17px] font-semibold text-foreground">EasyShiftHQ</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Verify your identity to continue</p>
      </div>
      {failedAttempts > 0 && (
        <>
          <p className="text-[13px] text-destructive">
            Authentication failed. {3 - failedAttempts} attempts remaining.
          </p>
          <Button
            onClick={onAuthenticate}
            className="h-11 px-8 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
          >
            Try Again
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useBiometricAuth.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBiometricAuth.ts src/components/BiometricLockScreen.tsx tests/unit/useBiometricAuth.test.ts
git commit -m "feat: add biometric auth hook and lock screen component"
```

---

## Task 8: Enhanced Camera — useNativeCamera Hook

**Files:**
- Create: `src/hooks/useNativeCamera.ts`
- Create: `tests/unit/useNativeCamera.test.ts`
- Modify: `src/components/ImageCapture.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/useNativeCamera.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: vi.fn() },
  CameraResultType: { Base64: 'base64' },
  CameraSource: { Camera: 'CAMERA' },
}));

import { base64ToBlob } from '@/hooks/useNativeCamera';

describe('useNativeCamera', () => {
  it('base64ToBlob converts base64 string to Blob', () => {
    // "Hello" in base64
    const blob = base64ToBlob('SGVsbG8=', 'jpeg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('image/jpeg');
  });

  it('base64ToBlob handles empty string', () => {
    const blob = base64ToBlob('', 'png');
    expect(blob.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useNativeCamera.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the native camera hook**

```typescript
// src/hooks/useNativeCamera.ts
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

/** Testable helper: convert base64 to Blob */
export function base64ToBlob(base64: string, format: string): Blob {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: `image/${format}` });
}

export function useNativeCamera() {
  const isNative = Capacitor.isNativePlatform();

  const takePhoto = async (): Promise<Blob | null> => {
    if (!isNative) return null;

    const photo = await Camera.getPhoto({
      quality: 80,
      source: CameraSource.Camera,
      resultType: CameraResultType.Base64,
      width: 480,
    });

    if (!photo.base64String) return null;
    return base64ToBlob(photo.base64String, photo.format);
  };

  return { isNative, takePhoto };
}
```

- [ ] **Step 2: Integrate into ImageCapture.tsx**

At the top of `ImageCapture.tsx`, add the native camera check. Before opening the web camera stream, check if native camera is available:

In the `startCamera` function (around line 39), add an early return for native:

```typescript
import { useNativeCamera } from '@/hooks/useNativeCamera';

// Inside the component, before the existing camera logic:
const { isNative, takePhoto: takeNativePhoto } = useNativeCamera();

// Add a new handler for native capture
const handleNativeCapture = async () => {
  const blob = await takeNativePhoto();
  if (blob) {
    const url = URL.createObjectURL(blob);
    onImageCaptured(blob, url);
  }
};
```

If `isNative` is true, render a simple capture button instead of the video stream. Otherwise, existing web camera code runs unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useNativeCamera.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useNativeCamera.ts tests/unit/useNativeCamera.test.ts src/components/ImageCapture.tsx
git commit -m "feat: add native camera hook with web fallback for ImageCapture"
```

---

## Task 9: Geofence Check — useGeofenceCheck Hook

**Files:**
- Create: `src/hooks/useGeofenceCheck.ts`
- Create: `tests/unit/useGeofenceCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/useGeofenceCheck.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: vi.fn(),
  }
}));

import { evaluateGeofence } from '@/hooks/useGeofenceCheck';

describe('evaluateGeofence', () => {
  it('returns skip when enforcement is off', () => {
    const result = evaluateGeofence('off', null, null, 200, 40.7, -74.0);
    expect(result.action).toBe('allow');
    expect(result.checked).toBe(false);
  });

  it('returns skip when restaurant has no coordinates', () => {
    const result = evaluateGeofence('warn', null, null, 200, 40.7, -74.0);
    expect(result.action).toBe('allow');
    expect(result.checked).toBe(false);
  });

  it('returns allow when within radius', () => {
    const result = evaluateGeofence('warn', 40.7128, -74.006, 200, 40.7129, -74.0061);
    expect(result.action).toBe('allow');
    expect(result.within).toBe(true);
  });

  it('returns warn when outside radius with warn enforcement', () => {
    const result = evaluateGeofence('warn', 40.7128, -74.006, 200, 40.72, -74.006);
    expect(result.action).toBe('warn');
    expect(result.within).toBe(false);
  });

  it('returns block when outside radius with block enforcement', () => {
    const result = evaluateGeofence('block', 40.7128, -74.006, 200, 40.72, -74.006);
    expect(result.action).toBe('block');
    expect(result.within).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useGeofenceCheck.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/hooks/useGeofenceCheck.ts
import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { haversineDistance } from '@/lib/haversine';

type Enforcement = 'off' | 'warn' | 'block';
type GeofenceAction = 'allow' | 'warn' | 'block';

interface GeofenceResult {
  action: GeofenceAction;
  checked: boolean;
  within?: boolean;
  distanceMeters?: number;
  userLat?: number;
  userLng?: number;
}

/** Pure, testable geofence evaluation */
export function evaluateGeofence(
  enforcement: Enforcement,
  restaurantLat: number | null,
  restaurantLng: number | null,
  radiusMeters: number,
  userLat: number,
  userLng: number
): GeofenceResult {
  if (enforcement === 'off' || restaurantLat == null || restaurantLng == null) {
    return { action: 'allow', checked: false };
  }

  const distance = haversineDistance(userLat, userLng, restaurantLat, restaurantLng);
  const within = distance <= radiusMeters;

  return {
    action: within ? 'allow' : enforcement,
    checked: true,
    within,
    distanceMeters: Math.round(distance),
    userLat,
    userLng,
  };
}

export function useGeofenceCheck(restaurant: {
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_meters?: number;
  geofence_enforcement?: Enforcement;
} | null) {
  const [checking, setChecking] = useState(false);

  const checkLocation = useCallback(async (): Promise<GeofenceResult> => {
    const enforcement = restaurant?.geofence_enforcement ?? 'off';
    const lat = restaurant?.latitude ?? null;
    const lng = restaurant?.longitude ?? null;
    const radius = restaurant?.geofence_radius_meters ?? 200;

    if (enforcement === 'off' || lat == null || lng == null) {
      return { action: 'allow', checked: false };
    }

    setChecking(true);
    try {
      const isNative = Capacitor.isNativePlatform();
      let userLat: number;
      let userLng: number;

      if (isNative) {
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
      } else {
        // Web fallback using existing navigator.geolocation
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 })
        );
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
      }

      return evaluateGeofence(enforcement, lat, lng, radius, userLat, userLng);
    } catch {
      // If location fails, allow clock-in but flag as unchecked
      return { action: 'allow', checked: false };
    } finally {
      setChecking(false);
    }
  }, [restaurant]);

  return { checkLocation, checking };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useGeofenceCheck.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGeofenceCheck.ts tests/unit/useGeofenceCheck.test.ts
git commit -m "feat: add geofence check hook with haversine distance evaluation"
```

---

## Task 10: Integrate Geofence into EmployeeClock

**Files:**
- Modify: `src/pages/EmployeeClock.tsx`
- Modify: `src/utils/punchContext.ts`

- [ ] **Step 1: Update punchContext to include geofence data**

In `src/utils/punchContext.ts`, extend the return type to include optional geofence fields:

```typescript
export interface PunchLocation {
  latitude: number;
  longitude: number;
  distance_meters?: number;
  within_geofence?: boolean;
}
```

Update `collectPunchContext` to accept and merge geofence data:

```typescript
export function mergePunchLocation(
  baseLocation: { latitude: number; longitude: number } | undefined,
  geofenceResult?: { distanceMeters?: number; within?: boolean }
): PunchLocation | undefined {
  if (!baseLocation) return undefined;
  return {
    ...baseLocation,
    ...(geofenceResult?.distanceMeters != null && {
      distance_meters: geofenceResult.distanceMeters,
      within_geofence: geofenceResult.within,
    }),
  };
}
```

- [ ] **Step 2: Integrate useGeofenceCheck into EmployeeClock**

In `src/pages/EmployeeClock.tsx`, import and use the geofence hook:

```typescript
import { useGeofenceCheck } from '@/hooks/useGeofenceCheck';
```

Before the existing `handleClockIn`:
1. Call `checkLocation()`
2. If result is `block`, show a toast and return early
3. If result is `warn`, show a warning toast but continue
4. Pass geofence result to `mergePunchLocation` when creating the punch

- [ ] **Step 3: Test manually and verify existing tests pass**

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/EmployeeClock.tsx src/utils/punchContext.ts
git commit -m "feat: integrate geofence check into employee clock-in flow"
```

---

## Task 11: Geofence Settings UI

**Files:**
- Create: `src/components/settings/GeofenceSettings.tsx`
- Modify: `src/pages/RestaurantSettings.tsx`

- [ ] **Step 1: Create GeofenceSettings component**

```typescript
// src/components/settings/GeofenceSettings.tsx
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';

interface GeofenceSettingsProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  enforcement: 'off' | 'warn' | 'block';
  onSave: (values: {
    latitude: number | null;
    longitude: number | null;
    geofence_radius_meters: number;
    geofence_enforcement: string;
  }) => void;
  saving: boolean;
}

export function GeofenceSettings({
  latitude, longitude, radiusMeters, enforcement, onSave, saving
}: GeofenceSettingsProps) {
  const [lat, setLat] = useState(latitude?.toString() ?? '');
  const [lng, setLng] = useState(longitude?.toString() ?? '');
  const [radius, setRadius] = useState(radiusMeters);
  const [mode, setMode] = useState(enforcement);

  const handleUseCurrentLocation = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      setLat(pos.coords.latitude.toFixed(6));
      setLng(pos.coords.longitude.toFixed(6));
    });
  };

  const handleSave = () => {
    onSave({
      latitude: lat ? parseFloat(lat) : null,
      longitude: lng ? parseFloat(lng) : null,
      geofence_radius_meters: radius,
      geofence_enforcement: mode,
    });
  };

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
        <h3 className="text-[13px] font-semibold text-foreground">Geofence Settings</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Require employees to be at the restaurant when clocking in
        </p>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Enforcement Mode
          </Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="warn">Warn (allow but flag)</SelectItem>
              <SelectItem value="block">Block (prevent clock-in)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode !== 'off' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Latitude
                </Label>
                <Input
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="40.7128"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
              <div>
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Longitude
                </Label>
                <Input
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="-74.006"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleUseCurrentLocation}
              className="h-9 text-[13px] font-medium rounded-lg"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Use Current Location
            </Button>
            <div>
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Radius (meters): {radius}m
              </Label>
              <input
                type="range"
                min={50}
                max={500}
                step={25}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full mt-2"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>50m</span>
                <span>500m</span>
              </div>
            </div>
          </>
        )}

        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
        >
          {saving ? 'Saving...' : 'Save Geofence Settings'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add GeofenceSettings to RestaurantSettings page**

In `src/pages/RestaurantSettings.tsx`, import and render `GeofenceSettings` in the appropriate tab, passing the restaurant's current geofence values and an `onSave` handler that updates via Supabase.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/GeofenceSettings.tsx src/pages/RestaurantSettings.tsx
git commit -m "feat: add geofence settings UI to restaurant settings"
```

---

## Task 12: Integrate Push + Biometrics into App Shell

**Files:**
- Modify: `src/components/employee/MobileLayout.tsx`
- Modify: `src/App.tsx` (or wherever top-level providers live)

- [ ] **Step 1: Add useDeviceToken to MobileLayout**

In `src/components/employee/MobileLayout.tsx`, call `useDeviceToken()` at the top level so it registers on mount for all employee pages:

```typescript
import { useDeviceToken } from '@/hooks/useDeviceToken';

export function MobileLayout({ children }: { children: React.ReactNode }) {
  useDeviceToken();
  // ... existing layout code
}
```

- [ ] **Step 2: Add biometric lock screen to MobileLayout**

```typescript
import { useBiometricAuth } from '@/hooks/useBiometricAuth';
import { BiometricLockScreen } from '@/components/BiometricLockScreen';
import { useAuth } from '@/contexts/AuthContext';

export function MobileLayout({ children }: { children: React.ReactNode }) {
  useDeviceToken();
  const { signOut } = useAuth();
  const bio = useBiometricAuth();

  // Lock on app resume
  useEffect(() => {
    if (!bio.isEnabled) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        bio.lock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [bio.isEnabled, bio.lock]);

  // Sign out after max failed attempts
  useEffect(() => {
    if (bio.shouldSignOut) {
      signOut();
    }
  }, [bio.shouldSignOut, signOut]);

  return (
    <div className="flex flex-col min-h-svh bg-background">
      {bio.isLocked && (
        <BiometricLockScreen
          onAuthenticate={bio.authenticate}
          failedAttempts={bio.failedAttempts}
        />
      )}
      <main /* existing styles */>{children}</main>
      <MobileTabBar />
    </div>
  );
}
```

- [ ] **Step 3: Add push notification deep link handling**

In `MobileLayout` or `App.tsx`, add listener for notification taps:

```typescript
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';

// Inside component:
const navigate = useNavigate();

useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    const route = notification.notification.data?.route;
    if (route) navigate(route);
  });

  return () => { PushNotifications.removeAllListeners(); };
}, [navigate]);
```

- [ ] **Step 4: Verify existing tests pass**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/employee/MobileLayout.tsx
git commit -m "feat: integrate push notifications and biometric auth into mobile layout"
```

---

## Task 13: Wire Push Notifications into Existing Edge Functions

**Files:**
- Modify: `supabase/functions/send-time-off-notification/index.ts`
- Modify: `supabase/functions/notify-schedule-published/index.ts`
- Modify: `supabase/functions/send-shift-trade-notification/index.ts`

- [ ] **Step 1: Add push call to time-off notification**

In the existing `send-time-off-notification` edge function, after the current notification logic, add a call to `send-push-notification`:

```typescript
// After existing email/in-app notification logic:
const pushRes = await fetch(
  `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({
      user_id: employeeUserId,
      title: 'Time-Off Update',
      body: `Your time-off request has been ${status}`,
      data: { route: '/employee/portal' },
    }),
  }
);
```

- [ ] **Step 2: Add push call to schedule published notification**

Same pattern in `notify-schedule-published`:

```typescript
// For each employee in the schedule:
await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
  },
  body: JSON.stringify({
    user_id: employeeUserId,
    title: 'Schedule Updated',
    body: 'A new schedule has been published',
    data: { route: '/employee/schedule' },
  }),
});
```

- [ ] **Step 3: Add push call to shift trade notification**

Same pattern in `send-shift-trade-notification`:

```typescript
// After existing notification logic:
await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
  },
  body: JSON.stringify({
    user_id: targetEmployeeUserId,
    title: 'Shift Trade Request',
    body: 'Someone wants to trade a shift with you',
    data: { route: '/employee/shifts' },
  }),
});
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-time-off-notification/ supabase/functions/notify-schedule-published/ supabase/functions/send-shift-trade-notification/
git commit -m "feat: add push notifications to time-off, schedule, and shift trade edge functions"
```

---

## Task 14: Final Build Verification & Native Platform Config

**Files:**
- Modify: `ios/App/App/Info.plist` (generated by Capacitor)
- Modify: `android/app/src/main/AndroidManifest.xml` (generated by Capacitor)

- [ ] **Step 1: Configure iOS permissions**

After `npx cap sync`, edit `ios/App/App/Info.plist` to add:
- `NSCameraUsageDescription` = "Used for clock-in photo verification"
- `NSLocationWhenInUseUsageDescription` = "Used to verify you're at the restaurant when clocking in"
- `NSFaceIDUsageDescription` = "Used for quick, secure login"

- [ ] **Step 2: Configure Android permissions**

Edit `android/app/src/main/AndroidManifest.xml` to include:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

- [ ] **Step 3: Run full build and sync**

Run: `npm run build:mobile`
Expected: Build succeeds, cap sync succeeds.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: All unit tests pass.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: No new lint errors introduced.

- [ ] **Step 6: Commit**

```bash
git add ios/ android/
git commit -m "feat: configure native permissions for iOS and Android"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Capacitor setup, Vite config, deps, native platforms | Build verification |
| 2 | Haversine distance utility | 5 unit tests |
| 3 | device_tokens table + RLS | 6 pgTAP tests |
| 4 | Restaurant geofence columns | 4 pgTAP tests |
| 5 | useDeviceToken hook | 2 unit tests |
| 6 | send-push-notification edge function | Manual test |
| 7 | useBiometricAuth hook + lock screen | 3 unit tests |
| 8 | useNativeCamera hook + ImageCapture integration | 2 unit tests |
| 9 | useGeofenceCheck hook | 5 unit tests |
| 10 | Geofence integration in EmployeeClock | Existing tests pass |
| 11 | Geofence settings UI | Manual test |
| 12 | Push + biometrics in MobileLayout | Existing tests pass |
| 13 | Push calls in 3 existing edge functions | Manual test |
| 14 | Native permissions + final verification | Full test suite |
