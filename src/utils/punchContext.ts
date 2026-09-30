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
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude };
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
  locationUnavailable = false
): PunchLocation {
  const base = context?.location ?? geofenceCoordinates(geofenceResult);
  return (
    mergePunchLocation(base, geofenceResult, locationUnavailable || base === undefined) ?? {
      location_unavailable: true,
    }
  );
}

const DEFAULT_LOCATION_TIMEOUT = 3000;
const DEFAULT_DEVICE_INFO_MAX = 100;
// How long a successful geolocation result stays addressable as the
// "in-flight" promise. A second employee within this window reuses the same
// fix; after it, the next punch starts a fresh getCurrentPosition so we don't
// ship a stale (potentially wrong-restaurant) location for the next shift.
// A failed result is not reused by the next punch flow (see startPunchContext).
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
    const fail = () => {
      clearTimeout(timeoutId);
      resolve(undefined);
    };
    // Some WebViews throw at once instead of calling the error callback. A
    // rejection here would lose an offline kiosk punch, so resolve undefined.
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timeoutId);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        fail,
        {
          timeout: timeoutMs,
          enableHighAccuracy: false,
          maximumAge: 60000,
        }
      );
    } catch {
      fail();
    }
  });
}

type PunchContextResult = {
  location: { latitude: number; longitude: number } | undefined;
  device_info: string;
};

let inFlight: Promise<PunchContextResult> | null = null;
let inFlightTimeout: ReturnType<typeof setTimeout> | null = null;
// True when the cached read resolved with no location. The next punch flow
// must read GPS again: a cached failure would flag that punch as
// location_unavailable with no read of its own.
let inFlightFailed = false;

const buildContext = async (timeoutMs: number): Promise<PunchContextResult> => {
  let location: PunchContextResult['location'];
  try {
    location = await getQuickLocation(timeoutMs);
  } catch {
    // A rejected read would stay cached and lose offline kiosk punches.
    location = undefined;
  }
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
 * A good result is reused for ~10s; after that, the next call starts a fresh
 * `getCurrentPosition`. A failed result is not reused by the next call.
 */
export function startPunchContext(timeoutMs = DEFAULT_LOCATION_TIMEOUT): Promise<PunchContextResult> {
  if (inFlight !== null && !inFlightFailed) return inFlight;
  if (inFlightTimeout) clearTimeout(inFlightTimeout);
  inFlightTimeout = null;
  inFlightFailed = false;
  const read: Promise<PunchContextResult> = buildContext(timeoutMs).then((result) => {
    // A newer read replaced this one; leave the cache to the newer read.
    if (inFlight !== read) return result;
    inFlightFailed = result.location === undefined;
    inFlightTimeout = setTimeout(() => {
      inFlight = null;
      inFlightTimeout = null;
      inFlightFailed = false;
    }, PUNCH_CONTEXT_REUSE_MS);
    return result;
  });
  inFlight = read;
  return read;
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
  inFlightFailed = false;
}
