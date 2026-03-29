import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
