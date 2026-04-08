import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

// Set to true once Firebase is configured (google-services.json added to Android,
// GoogleService-Info.plist added to iOS). Without Firebase, calling any
// PushNotifications method crashes the native app.
const PUSH_NOTIFICATIONS_ENABLED = false;

/** Testable helper: should we register for push? */
export function shouldRegisterForPush(isNative: boolean): boolean {
  return isNative && PUSH_NOTIFICATIONS_ENABLED;
}

export function useDeviceToken() {
  const { user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!shouldRegisterForPush(isNative) || !user || !selectedRestaurant) return;

    // Dynamically import to avoid loading the native plugin at all
    // if we never reach this code path. The native PushNotifications plugin
    // crashes on Android if Firebase/google-services.json is not configured.
    const registerToken = async () => {
      try {
        const permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') return;

        PushNotifications.addListener('registration', async ({ value: token }) => {
          try {
            const platform = Capacitor.getPlatform() as 'ios' | 'android';
            await (supabase.from as any)('device_tokens').upsert(
              {
                user_id: user.id,
                restaurant_id: selectedRestaurant.id,
                token,
                platform,
              },
              { onConflict: 'user_id,token' }
            );
          } catch (e) {
            console.warn('Failed to save device token:', e);
          }
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.warn('Push registration failed:', error);
        });

        await PushNotifications.register();
      } catch (e) {
        console.warn('Push notification registration error:', e);
      }
    };

    registerToken();

    return () => {
      PushNotifications.removeAllListeners().catch(() => { /* ignore cleanup errors */ })
    };
  }, [isNative, user, selectedRestaurant]);
}
