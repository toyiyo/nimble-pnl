import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { supabase } from '@/integrations/supabase/client';

/**
 * Listens for deep link callbacks from OAuth (e.g. com.easyshifthq.employee://#access_token=...)
 * and completes the Supabase auth session.
 *
 * Call this once at app startup (e.g. in App.tsx or main.tsx).
 */
export function setupDeepLinkAuth() {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    const url = event.url;

    // OAuth redirects come back as: com.easyshifthq.employee://#access_token=...&refresh_token=...
    // or: com.easyshifthq.employee:///?code=...
    if (!url.startsWith('com.easyshifthq.employee://')) return;

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
