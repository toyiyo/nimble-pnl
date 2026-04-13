import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

const DISMISS_KEY = 'push_banner_dismissed_at';

function getVapidPublicKey(): string | undefined {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function shouldShowBanner(
  isSupported: boolean,
  permission: NotificationPermission | null,
  isSubscribed: boolean,
  dismissedAt: number | null
): boolean {
  if (!isSupported) return false;
  if (permission === 'denied') return false;
  if (isSubscribed) return false;
  if (dismissedAt) {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissedAt < thirtyDaysMs) return false;
  }
  return true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPushSubscription() {
  const { user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const [isSupported] = useState(() => isWebPushSupported());
  const [permission, setPermission] = useState<NotificationPermission | null>(
    () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : null)
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check existing subscription on mount
  useEffect(() => {
    if (!isSupported) return;

    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    }).catch((err) => {
      console.warn('Failed to check push subscription:', err);
    });
  }, [isSupported]);

  // Register service worker on mount (only if supported)
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    const vapidKey = getVapidPublicKey();
    if (!isSupported) {
      console.warn('Web push not supported in this browser');
      return;
    }
    if (!user || !restaurantId) {
      console.warn('Cannot subscribe: no authenticated user or restaurant');
      return;
    }
    if (!vapidKey) {
      console.error('Cannot subscribe: VITE_VAPID_PUBLIC_KEY is not configured');
      return;
    }

    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const json = subscription.toJSON();
      const { error } = await supabase.functions.invoke('manage-web-push-subscription', {
        method: 'POST',
        body: {
          endpoint: json.endpoint,
          keys: json.keys,
          restaurant_id: restaurantId,
        },
      });

      if (error) {
        await subscription.unsubscribe();
        throw error;
      }
      setIsSubscribed(true);
    } catch (err) {
      console.error('Failed to subscribe to web push:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, user, restaurantId]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await supabase.functions.invoke('manage-web-push-subscription', {
          method: 'DELETE',
          body: { endpoint },
        });
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error('Failed to unsubscribe from web push:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }, []);

  const dismissedAt = (() => {
    if (typeof window === 'undefined') return null;
    const val = localStorage.getItem(DISMISS_KEY);
    return val ? Number(val) : null;
  })();

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    dismiss,
    shouldShowBanner: shouldShowBanner(isSupported, permission, isSubscribed, dismissedAt),
  };
}
