export interface PunchLocation {
  latitude?: number;
  longitude?: number;
  distance_meters?: number;
  within_geofence?: boolean;
  location_unavailable?: boolean;
}

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

export interface PunchGeofenceResult {
  distanceMeters?: number;
  within?: boolean;
  latitude?: number;
  longitude?: number;
}

function geofenceCoordinates(
  geofenceResult?: PunchGeofenceResult
): { latitude: number; longitude: number } | undefined {
  const latitude = geofenceResult?.latitude;
  const longitude = geofenceResult?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { latitude: latitude as number, longitude: longitude as number };
}

/**
 * Builds the punch location for a punch that tried to read GPS.
 * Uses the quick-read coordinates, else the geofence coordinates.
 * Sets `location_unavailable` when there are no coordinates, or when the
 * geofence check failed. A distance alone is not a position: the server
 * trigger deletes a client distance and flags only from coordinates.
 * Do not use this for a punch that never reads GPS (manual or imported).
 */
export function punchContextLocation(
  context: { location?: { latitude: number; longitude: number } } | null | undefined,
  geofenceResult?: PunchGeofenceResult,
  geofenceUnavailable = false
): PunchLocation {
  const base = context?.location ?? geofenceCoordinates(geofenceResult);
  return (
    mergePunchLocation(base, geofenceResult, geofenceUnavailable || base == null) ?? {
      location_unavailable: true,
    }
  );
}

const DEFAULT_LOCATION_TIMEOUT = 3000;
const DEFAULT_DEVICE_INFO_MAX = 100;
// How long a resolved geolocation result stays addressable as the "in-flight"
// promise. A second employee within this window reuses the same fix; after
// it, the next punch starts a fresh getCurrentPosition so we don't ship a
// stale (potentially wrong-restaurant) location for the next shift.
const PUNCH_CONTEXT_REUSE_MS = 10_000;

export function getDeviceInfo(maxLength = DEFAULT_DEVICE_INFO_MAX): string {
  if (typeof navigator === 'undefined') return 'unknown device';
  return navigator.userAgent.substring(0, maxLength);
}

export function getQuickLocation(timeoutMs = DEFAULT_LOCATION_TIMEOUT): Promise<{ latitude: number; longitude: number } | undefined> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeoutId);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        clearTimeout(timeoutId);
        resolve(undefined);
      },
      {
        timeout: timeoutMs,
        enableHighAccuracy: false,
        maximumAge: 60000,
      }
    );
  });
}

type PunchContextResult = {
  location: { latitude: number; longitude: number } | undefined;
  device_info: string;
};

let inFlight: Promise<PunchContextResult> | null = null;
let inFlightTimeout: ReturnType<typeof setTimeout> | null = null;

const buildContext = async (timeoutMs: number): Promise<PunchContextResult> => {
  const location = await getQuickLocation(timeoutMs);
  return {
    location,
    device_info: getDeviceInfo(),
  };
};

/**
 * Kick off geolocation + device_info collection eagerly, returning a single
 * shared promise across concurrent callers. Designed to be called the moment
 * the user opens the camera dialog so the OS has a head start before they
 * actually tap Confirm.
 *
 * The result is reused for ~10s; after that, the next call starts a fresh
 * `getCurrentPosition`.
 */
export function startPunchContext(timeoutMs = DEFAULT_LOCATION_TIMEOUT): Promise<PunchContextResult> {
  if (inFlight !== null) return inFlight;
  inFlight = buildContext(timeoutMs).finally(() => {
    if (inFlightTimeout) clearTimeout(inFlightTimeout);
    inFlightTimeout = setTimeout(() => {
      inFlight = null;
      inFlightTimeout = null;
    }, PUNCH_CONTEXT_REUSE_MS);
  });
  return inFlight;
}

/**
 * Collect punch context. If `startPunchContext` was already called (e.g. when
 * the camera dialog opened), this awaits the same in-flight promise instead
 * of starting a redundant `getCurrentPosition`.
 */
export async function collectPunchContext(timeoutMs = DEFAULT_LOCATION_TIMEOUT) {
  if (inFlight !== null) return inFlight;
  return buildContext(timeoutMs);
}

/**
 * Test-only escape hatch so isolated tests can re-arm `startPunchContext`.
 * Production callers must not use this.
 */
export function _resetPunchContextForTests() {
  if (inFlightTimeout) clearTimeout(inFlightTimeout);
  inFlight = null;
  inFlightTimeout = null;
}
