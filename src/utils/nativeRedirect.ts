import { Capacitor } from '@capacitor/core';

/**
 * Returns the correct OAuth redirect URL for the current platform.
 *
 * On native (Capacitor), we redirect back using the custom URL scheme
 * `com.easyshifthq.employee://` which Android/iOS intercept and reopen
 * the app. Supabase appends the auth tokens as URL fragments.
 *
 * On web, we use window.location.origin as before.
 */
export function getOAuthRedirectUrl(path: string = '/'): string {
  if (Capacitor.isNativePlatform()) {
    // Strip leading slash to avoid triple-slash (scheme:///path)
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `com.easyshifthq.employee://callback/${cleanPath}`;
  }
  return `${window.location.origin}${path}`;
}
