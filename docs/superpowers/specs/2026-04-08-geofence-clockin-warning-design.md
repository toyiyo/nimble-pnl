# Geofence Clock-In Warning & Enforcement

## Problem

Geofence settings are configured with "Warn (allow but flag)" enforcement mode, but the warning is a transient toast notification that disappears in seconds and requires no acknowledgment. Additionally, employees can bypass the geofence entirely by denying location permissions — the system silently allows the clock-in with no record. Managers have no visibility into flagged punches on the Time Punches list.

## Decisions

| Question | Decision |
|----------|----------|
| Kiosk mode geofence? | Skip — device is physically at the restaurant |
| Location permission denied? | Permissive — always warn and allow, regardless of enforcement mode |
| Warn mode UX? | Confirmation dialog requiring explicit acknowledgment |
| Manager notification? | Visual flag on Time Punches list (no real-time push) |

## Changes

### 1. Warn Mode — Confirmation Dialog

**File:** `src/pages/EmployeeClock.tsx`

When `geofenceResult.action === 'warn'`, replace the transient toast with a modal dialog before proceeding to the camera:

- **Component:** shadcn `AlertDialog`
- **Title:** "Location Warning"
- **Body:** "You appear to be **X meters** from the restaurant. Do you want to continue clocking in?"
- **Actions:** "Continue Anyway" (proceeds to camera) | "Cancel" (closes dialog, no punch)

Flow change: `handleInitiatePunch` sets a `geofenceWarning` state instead of calling `toast()`. The AlertDialog renders based on that state. "Continue Anyway" calls a new `handleProceedAfterWarning()` that opens the camera dialog.

### 2. Location Unavailable — Warning Dialog

**File:** `src/hooks/useGeofenceCheck.ts`

Currently, geolocation failure returns `{ action: 'allow', checked: false }` — indistinguishable from "geofence is off." Change to return a distinct result:

```typescript
// New result when geolocation fails and enforcement is enabled
{ action: 'allow', checked: false, locationUnavailable: true }
```

**File:** `src/pages/EmployeeClock.tsx`

When `geofenceResult.locationUnavailable === true`:

- **Title:** "Location Unavailable"
- **Body:** "We couldn't verify your location. You can still clock in, but this will be flagged for manager review."
- **Actions:** "Continue Anyway" | "Cancel"

Same dialog pattern as warn mode. Uses the same `geofenceWarning` state with a different message variant.

### 3. Block Mode + Location Unavailable

- Location IS available + outside geofence → **block** (existing behavior, unchanged)
- Location is UNAVAILABLE → show "Location Unavailable" warning dialog and **allow** (permissive policy)

This means the `block` enforcement mode only truly blocks when we have confirmed GPS coordinates outside the radius.

### 4. Punch Location Data — `location_unavailable` Field

**File:** `src/utils/punchContext.ts`

Extend `PunchLocation` interface:

```typescript
export interface PunchLocation {
  latitude: number;
  longitude: number;
  distance_meters?: number;
  within_geofence?: boolean;
  location_unavailable?: boolean;  // NEW
}
```

When location is unavailable, store `{ location_unavailable: true }` in the punch's `location` JSONB (no lat/lng since we don't have them). Update `mergePunchLocation` to handle this case.

### 5. Manager Visibility — Flagged Punch Indicators

**File:** `src/pages/TimePunchesManager.tsx`

Add visual indicators next to flagged punches:

- **Amber badge** with map-pin icon: `within_geofence === false` — "Clocked in X meters from restaurant"
- **Gray badge** with map-pin-off icon: `location_unavailable === true` — "Location was unavailable"
- Tooltip on hover with details

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useGeofenceCheck.ts` | Add `locationUnavailable` to `GeofenceResult`, return it on geolocation failure |
| `src/pages/EmployeeClock.tsx` | Replace toast with AlertDialog for warn + location-unavailable cases |
| `src/utils/punchContext.ts` | Add `location_unavailable` to `PunchLocation`, update `mergePunchLocation` |
| `src/pages/TimePunchesManager.tsx` | Add geofence flag badges with tooltips next to flagged punches |

## Out of Scope

- Kiosk mode changes (device is at the restaurant)
- Real-time manager notifications (future enhancement)
- Geofence checks for clock-out, break-start, break-end (only clock-in)
- Email/daily summary of violations (future enhancement)

## Testing

| Area | Tests |
|------|-------|
| `useGeofenceCheck` | New `locationUnavailable` result when geolocation fails with enforcement enabled |
| `useGeofenceCheck` | `locationUnavailable` NOT set when enforcement is 'off' (no check needed) |
| `punchContext` | `mergePunchLocation` handles `location_unavailable: true` with no lat/lng |
| `punchContext` | `mergePunchLocation` handles normal warn case (has lat/lng + distance) |
| Geofence flag display | Renders amber badge for outside-geofence punches |
| Geofence flag display | Renders gray badge for location-unavailable punches |
| Geofence flag display | No badge for normal punches |
