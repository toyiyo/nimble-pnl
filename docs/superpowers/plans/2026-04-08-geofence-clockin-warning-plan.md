# Geofence Clock-In Warning & Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make geofence warnings require explicit acknowledgment, handle location permission denial gracefully, and show flagged punches to managers.

**Architecture:** Extend `GeofenceResult` with a `locationUnavailable` flag so the caller can distinguish "geofence off" from "location failed." Replace the transient toast in `EmployeeClock` with an `AlertDialog` that blocks the flow until the employee explicitly continues or cancels. Add visual badges to the punch list in `TimePunchesManager`.

**Tech Stack:** React, shadcn/ui AlertDialog, Vitest, existing `useGeofenceCheck` hook

**Spec:** `docs/superpowers/specs/2026-04-08-geofence-clockin-warning-design.md`

---

### Task 1: Add `locationUnavailable` to GeofenceResult

**Files:**
- Modify: `src/hooks/useGeofenceCheck.ts`
- Test: `tests/unit/useGeofenceCheck.test.ts`

- [ ] **Step 1: Write failing tests for `locationUnavailable`**

Add these tests to the existing "web geolocation" describe block in `tests/unit/useGeofenceCheck.test.ts`:

```typescript
// Add to "useGeofenceCheck hook – web geolocation" describe block

it('returns locationUnavailable=true when geolocation throws and enforcement is warn', async () => {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn().mockImplementation((_res, reject) => {
        reject(new Error('permission denied'));
      }),
    },
  });

  const restaurant = {
    latitude: 40.7128,
    longitude: -74.006,
    geofence_radius_meters: 200,
    geofence_enforcement: 'warn' as const,
  };

  const { result } = renderHook(() => useGeofenceCheck(restaurant));
  let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

  await act(async () => {
    geofenceResult = await result.current.checkLocation();
  });

  expect(geofenceResult?.action).toBe('allow');
  expect(geofenceResult?.checked).toBe(false);
  expect(geofenceResult?.locationUnavailable).toBe(true);
});

it('returns locationUnavailable=true when geolocation throws and enforcement is block', async () => {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn().mockImplementation((_res, reject) => {
        reject(new Error('location services disabled'));
      }),
    },
  });

  const restaurant = {
    latitude: 40.7128,
    longitude: -74.006,
    geofence_radius_meters: 200,
    geofence_enforcement: 'block' as const,
  };

  const { result } = renderHook(() => useGeofenceCheck(restaurant));
  let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

  await act(async () => {
    geofenceResult = await result.current.checkLocation();
  });

  expect(geofenceResult?.action).toBe('allow');
  expect(geofenceResult?.checked).toBe(false);
  expect(geofenceResult?.locationUnavailable).toBe(true);
});

it('does NOT set locationUnavailable when enforcement is off', async () => {
  const restaurant = {
    latitude: 40.7128,
    longitude: -74.006,
    geofence_radius_meters: 200,
    geofence_enforcement: 'off' as const,
  };

  const { result } = renderHook(() => useGeofenceCheck(restaurant));
  let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

  await act(async () => {
    geofenceResult = await result.current.checkLocation();
  });

  expect(geofenceResult?.locationUnavailable).toBeUndefined();
});

it('does NOT set locationUnavailable when geolocation succeeds', async () => {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn().mockImplementation((resolve) => {
        resolve({ coords: { latitude: 40.7129, longitude: -74.0061 } });
      }),
    },
  });

  const restaurant = {
    latitude: 40.7128,
    longitude: -74.006,
    geofence_radius_meters: 500,
    geofence_enforcement: 'warn' as const,
  };

  const { result } = renderHook(() => useGeofenceCheck(restaurant));
  let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

  await act(async () => {
    geofenceResult = await result.current.checkLocation();
  });

  expect(geofenceResult?.locationUnavailable).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useGeofenceCheck.test.ts`
Expected: 4 new tests FAIL — `locationUnavailable` property doesn't exist on `GeofenceResult`

- [ ] **Step 3: Update `GeofenceResult` interface and catch block**

In `src/hooks/useGeofenceCheck.ts`, make these changes:

Add `locationUnavailable` to the interface (line 9-16):

```typescript
interface GeofenceResult {
  action: GeofenceAction;
  checked: boolean;
  within?: boolean;
  distanceMeters?: number;
  userLat?: number;
  userLng?: number;
  locationUnavailable?: boolean;
}
```

Update the catch block (line 72-73) to set `locationUnavailable: true`:

```typescript
    } catch {
      return { action: 'allow', checked: false, locationUnavailable: true };
    } finally {
```

- [ ] **Step 4: Update existing test expectation**

The existing test at line 192-218 ("returns allow/unchecked when geolocation throws") now also has `locationUnavailable: true`. Update it:

```typescript
it('returns allow/unchecked with locationUnavailable when geolocation throws', async () => {
  // ... existing setup ...

  expect(geofenceResult?.action).toBe('allow');
  expect(geofenceResult?.checked).toBe(false);
  expect(geofenceResult?.locationUnavailable).toBe(true);
  expect(result.current.checking).toBe(false);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useGeofenceCheck.test.ts`
Expected: ALL tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useGeofenceCheck.ts tests/unit/useGeofenceCheck.test.ts
git commit -m "feat: add locationUnavailable flag to GeofenceResult for permission denial detection"
```

---

### Task 2: Extend `PunchLocation` and `mergePunchLocation` for location unavailable

**Files:**
- Modify: `src/utils/punchContext.ts`
- Test: `tests/unit/punchContext.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `mergePunchLocation` describe block in `tests/unit/punchContext.test.ts`:

```typescript
it('returns location_unavailable when locationUnavailable flag is set', () => {
  const result = mergePunchLocation(undefined, undefined, true);
  expect(result).toEqual({ location_unavailable: true });
});

it('includes location_unavailable alongside coordinates when both exist', () => {
  const result = mergePunchLocation(
    { latitude: 40.7, longitude: -74.0 },
    undefined,
    true
  );
  expect(result).toEqual({
    latitude: 40.7,
    longitude: -74.0,
    location_unavailable: true,
  });
});

it('does not include location_unavailable when flag is false', () => {
  const result = mergePunchLocation(
    { latitude: 40.7, longitude: -74.0 },
    { distanceMeters: 50, within: true },
    false
  );
  expect(result).toEqual({
    latitude: 40.7,
    longitude: -74.0,
    distance_meters: 50,
    within_geofence: true,
  });
  expect(result).not.toHaveProperty('location_unavailable');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/punchContext.test.ts`
Expected: 3 new tests FAIL — `mergePunchLocation` doesn't accept 3rd parameter

- [ ] **Step 3: Update `PunchLocation` interface and `mergePunchLocation`**

In `src/utils/punchContext.ts`, update the interface (lines 1-6):

```typescript
export interface PunchLocation {
  latitude?: number;
  longitude?: number;
  distance_meters?: number;
  within_geofence?: boolean;
  location_unavailable?: boolean;
}
```

Note: `latitude` and `longitude` become optional to support the case where only `location_unavailable: true` is stored (no GPS coordinates available).

Update `mergePunchLocation` (lines 8-20):

```typescript
export function mergePunchLocation(
  baseLocation: { latitude: number; longitude: number } | undefined,
  geofenceResult?: { distanceMeters?: number; within?: boolean },
  locationUnavailable?: boolean
): PunchLocation | undefined {
  if (!baseLocation && !locationUnavailable) return undefined;
  return {
    ...baseLocation,
    ...(geofenceResult?.distanceMeters != null && {
      distance_meters: geofenceResult.distanceMeters,
      within_geofence: geofenceResult.within,
    }),
    ...(locationUnavailable && { location_unavailable: true }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/punchContext.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/punchContext.ts tests/unit/punchContext.test.ts
git commit -m "feat: extend PunchLocation with location_unavailable field"
```

---

### Task 3: Replace toast with AlertDialog in EmployeeClock

**Files:**
- Modify: `src/pages/EmployeeClock.tsx`

- [ ] **Step 1: Add geofence warning state**

Add new state variables after line 24 (`pendingGeofenceResult` state):

```typescript
const [geofenceWarning, setGeofenceWarning] = useState<{
  type: 'outside' | 'unavailable';
  distanceMeters?: number;
} | null>(null);
```

- [ ] **Step 2: Add AlertDialog import**

Update the imports at the top of the file. Replace the Dialog import line (line 7) with:

```typescript
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
```

Also add `MapPinOff` to the lucide-react import (line 10):

```typescript
import { Clock, LogIn, LogOut, Coffee, PlayCircle, AlertCircle, Camera, MapPin, MapPinOff, Shield, CheckCircle } from 'lucide-react';
```

- [ ] **Step 3: Rewrite `handleInitiatePunch` geofence logic**

Replace the geofence section of `handleInitiatePunch` (lines 104-133) with:

```typescript
const handleInitiatePunch = async (punchType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
  // Run geofence check before allowing clock-in
  if (punchType === 'clock_in') {
    const geofenceResult = await checkLocation();

    if (geofenceResult.action === 'block') {
      toast({
        title: 'Location Required',
        description: 'You must be at the restaurant to clock in.',
        variant: 'destructive',
      });
      return;
    }

    if (geofenceResult.action === 'warn') {
      // Show confirmation dialog instead of toast
      setPendingPunchType(punchType);
      setPendingGeofenceResult(geofenceResult.checked ? { distanceMeters: geofenceResult.distanceMeters, within: geofenceResult.within } : undefined);
      setGeofenceWarning({ type: 'outside', distanceMeters: geofenceResult.distanceMeters });
      return;
    }

    if (geofenceResult.locationUnavailable) {
      // Show location unavailable dialog
      setPendingPunchType(punchType);
      setPendingGeofenceResult(undefined);
      setGeofenceWarning({ type: 'unavailable' });
      return;
    }

    setPendingGeofenceResult(geofenceResult.checked ? { distanceMeters: geofenceResult.distanceMeters, within: geofenceResult.within } : undefined);
  } else {
    setPendingGeofenceResult(undefined);
  }

  setPendingPunchType(punchType);
  setShowCameraDialog(true);
  setCapturedPhoto(null);
  setTimeout(startCamera, 100);
};
```

- [ ] **Step 4: Add proceed-after-warning handler**

Add this after `handleInitiatePunch`:

```typescript
const handleProceedAfterWarning = () => {
  setGeofenceWarning(null);
  setShowCameraDialog(true);
  setCapturedPhoto(null);
  setTimeout(startCamera, 100);
};

const handleCancelWarning = () => {
  setGeofenceWarning(null);
  setPendingPunchType(null);
  setPendingGeofenceResult(undefined);
};
```

- [ ] **Step 5: Update `handleConfirmPunch` to pass `locationUnavailable`**

Update the `location` line in `handleConfirmPunch` (line 175):

```typescript
location: mergePunchLocation(
  context?.location,
  geofenceResult,
  geofenceWarning?.type === 'unavailable' || pendingGeofenceResult === undefined && geofenceWarning !== null
),
```

Wait — at this point `geofenceWarning` is already cleared. Instead, capture the unavailable flag alongside the geofence result. Add another state variable after the `geofenceWarning` state:

```typescript
const [pendingLocationUnavailable, setPendingLocationUnavailable] = useState(false);
```

In `handleInitiatePunch`, when `geofenceResult.locationUnavailable`:
```typescript
setPendingLocationUnavailable(true);
```

In the normal allow path and the warn path, set it to false:
```typescript
setPendingLocationUnavailable(false);
```

In `handleConfirmPunch`, after line 142 (`const geofenceResult = pendingGeofenceResult;`):
```typescript
const locationUnavailable = pendingLocationUnavailable;
```

Then clear it with the other pending state (after line 146):
```typescript
setPendingLocationUnavailable(false);
```

And update the `location` line:
```typescript
location: mergePunchLocation(context?.location, geofenceResult, locationUnavailable),
```

- [ ] **Step 6: Add the geofence warning AlertDialog JSX**

Add this before the closing `</div>` of the component (before line 529), after the Camera Dialog:

```typescript
{/* Geofence Warning Dialog */}
<AlertDialog open={geofenceWarning !== null} onOpenChange={(open) => {
  if (!open) handleCancelWarning();
}}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          {geofenceWarning?.type === 'unavailable'
            ? <MapPinOff className="h-5 w-5 text-amber-600" />
            : <MapPin className="h-5 w-5 text-amber-600" />
          }
        </div>
        <div>
          <AlertDialogTitle className="text-[17px] font-semibold">
            {geofenceWarning?.type === 'unavailable' ? 'Location Unavailable' : 'Location Warning'}
          </AlertDialogTitle>
        </div>
      </div>
    </AlertDialogHeader>
    <AlertDialogDescription className="text-[14px] text-muted-foreground">
      {geofenceWarning?.type === 'unavailable'
        ? "We couldn't verify your location. You can still clock in, but this will be flagged for manager review."
        : `You appear to be ${geofenceWarning?.distanceMeters ?? '?'} meters from the restaurant. Do you want to continue clocking in?`
      }
    </AlertDialogDescription>
    <AlertDialogFooter>
      <Button variant="outline" onClick={handleCancelWarning}>
        Cancel
      </Button>
      <Button
        className="bg-amber-600 hover:bg-amber-700 text-white"
        onClick={handleProceedAfterWarning}
      >
        Continue Anyway
      </Button>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 7: Verify the AlertDialog component exists**

Run: `ls src/components/ui/alert-dialog.tsx`
If it doesn't exist: `npx shadcn@latest add alert-dialog`

- [ ] **Step 8: Run typecheck and dev server quick smoke test**

Run: `npm run typecheck`
Expected: No new type errors

- [ ] **Step 9: Commit**

```bash
git add src/pages/EmployeeClock.tsx
git commit -m "feat: replace geofence toast with confirmation dialog requiring acknowledgment"
```

---

### Task 4: Add geofence flag badges to TimePunchesManager

**Files:**
- Modify: `src/pages/TimePunchesManager.tsx`

- [ ] **Step 1: Add `MapPinOff` to lucide imports**

Find the lucide-react import in TimePunchesManager.tsx and add `MapPinOff`:

```typescript
// Add MapPinOff to the existing import
import { ..., MapPinOff, ... } from 'lucide-react';
```

Also add the `Tooltip` components if not already imported:

```typescript
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
```

- [ ] **Step 2: Replace the location badge in the punch row**

Find the existing location badge (around line 807-811):

```typescript
{punch.location && (
  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
    <MapPin className="h-3 w-3" />
  </Badge>
)}
```

Replace with geofence-aware badges:

```typescript
{punch.location && (
  punch.location.location_unavailable ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20">
            <MapPinOff className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Location was unavailable at clock-in</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : punch.location.within_geofence === false ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
            <MapPin className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Clocked in {punch.location.distance_meters}m from restaurant</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
      <MapPin className="h-3 w-3" />
    </Badge>
  )
)}
```

- [ ] **Step 3: Update the punch detail view**

Find the location section in the viewing dialog (around line 1080-1091) and add geofence status after coordinates:

```typescript
{viewingPunch.location && (
  <div className="space-y-1">
    <p className="text-sm font-medium">Location</p>
    {viewingPunch.location.location_unavailable ? (
      <p className="text-sm text-muted-foreground flex items-center gap-1">
        <MapPinOff className="h-3.5 w-3.5 text-gray-500" />
        Location was unavailable
      </p>
    ) : (
      <>
        <p className="text-sm text-muted-foreground">
          {viewingPunch.location.latitude?.toFixed(6)}, {viewingPunch.location.longitude?.toFixed(6)}
        </p>
        {viewingPunch.location.within_geofence === false && (
          <p className="text-sm text-amber-600 flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {viewingPunch.location.distance_meters}m from restaurant
          </p>
        )}
        {viewingPunch.location.latitude != null && viewingPunch.location.longitude != null && (
          <a
            href={`https://www.google.com/maps?q=${viewingPunch.location.latitude},${viewingPunch.location.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            View on map
          </a>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Check that the `location` type in the punch includes the new fields**

Search for the TypeScript type used for `punch.location`. If it's typed as `{ latitude: number; longitude: number }` or similar, it will need updating. Check `useTimePunches.tsx` for the type definition.

If the location field is typed as a generic JSONB/`any`, no change needed. If it has a specific interface, update it to match `PunchLocation` from `punchContext.ts`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No new type errors

- [ ] **Step 6: Commit**

```bash
git add src/pages/TimePunchesManager.tsx
git commit -m "feat: add geofence flag badges on time punches list for manager visibility"
```

---

### Task 5: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: ALL tests PASS, no regressions

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new lint errors (pre-existing errors OK)

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit any remaining changes and push**

```bash
git push -u origin <branch-name>
```
