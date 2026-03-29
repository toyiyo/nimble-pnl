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
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 })
        );
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
      }

      return evaluateGeofence(enforcement, lat, lng, radius, userLat, userLng);
    } catch {
      return { action: 'allow', checked: false };
    } finally {
      setChecking(false);
    }
  }, [restaurant]);

  return { checkLocation, checking };
}
