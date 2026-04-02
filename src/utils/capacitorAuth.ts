import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';

/**
 * Listens for deep link callbacks from OAuth and completes the Supabase auth session.
 * Also closes the Chrome Custom Tab after auth completes.
 *
 * Call this once at app startup (in main.tsx).
 */
export function setupDeepLinkAuth() {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    const url = event.url;

    if (!url.startsWith('com.easyshifthq.employee://')) return;

    // Close the Chrome Custom Tab that was used for auth
    try {
      await Browser.close();
    } catch {
      // Browser may already be closed
    }

    // Extract the fragment (after #) which contains the tokens
    const hashIndex = url.indexOf('#');
    if (hashIndex >= 0) {
      const fragment = url.substring(hashIndex + 1);
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        return;
      }
    }

    // Handle PKCE flow (code in query params)
    const queryIndex = url.indexOf('?');
    if (queryIndex >= 0) {
      const query = url.substring(queryIndex + 1);
      const params = new URLSearchParams(query);
      const code = params.get('code');

      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      }
    }
  });
}
