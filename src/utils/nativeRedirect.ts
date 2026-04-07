import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns the correct OAuth redirect URL for the current platform.
 */
export function getOAuthRedirectUrl(path: string = '/'): string {
  if (Capacitor.isNativePlatform()) {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `com.easyshifthq.employee://callback/${cleanPath}`;
  }
  return `${window.location.origin}${path}`;
}

/**
 * Performs OAuth sign-in on native using Chrome Custom Tabs instead of
 * the system browser. This keeps the auth flow within the app context
 * and properly handles the custom URL scheme redirect back.
 *
 * On web, falls back to the normal signInWithOAuth flow.
 */
export async function signInWithOAuthNative(
  provider: 'google' | 'github' | 'azure' | 'linkedin_oidc',
  redirectPath: string = '/'
): Promise<{ error: Error | null }> {
  const redirectTo = getOAuthRedirectUrl(redirectPath);

  if (!Capacitor.isNativePlatform()) {
    // Web: use normal redirect flow
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    return { error };
  }

  // Native: get the auth URL without auto-opening browser
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      queryParams: { access_type: 'offline', prompt: 'consent' },
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    return { error: error || new Error('No auth URL returned') };
  }

  // Open in Chrome Custom Tab (stays within app context)
  await Browser.open({ url: data.url, windowName: '_self' });
  return { error: null };
}
