type LocationResult = { latitude: number; longitude: number } | undefined;

export interface PunchLocation {
  latitude: number;
  longitude: number;
  distance_meters?: number;
  within_geofence?: boolean;
}

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

const DEFAULT_LOCATION_TIMEOUT = 3000;
const DEFAULT_DEVICE_INFO_MAX = 100;

export const getDeviceInfo = (maxLength = DEFAULT_DEVICE_INFO_MAX): string => {
  if (typeof navigator === 'undefined') return 'unknown device';
  return navigator.userAgent.substring(0, maxLength);
};

export const getQuickLocation = (timeoutMs = DEFAULT_LOCATION_TIMEOUT): Promise<LocationResult> => {
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
};

export const collectPunchContext = async (timeoutMs = DEFAULT_LOCATION_TIMEOUT) => {
  const location = await getQuickLocation(timeoutMs);
  return {
    location,
    device_info: getDeviceInfo(),
  };
};
