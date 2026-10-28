// A POS callback page needs the session of the user who started the connect:
// the callback edge functions reject a caller with no session (401). On a phone,
// the provider often returns to a browser where the user is not signed in.
// This helper saves the callback URL and opens sign-in; the Auth page then
// returns the user to the same URL to finish the connect.

import { savePosCallbackReturnPath, type PosCallbackProvider } from '@/lib/oauthReturnPath';

interface RedirectToSignInParams {
  provider: PosCallbackProvider;
  code: string;
  state: string;
  getSession: () => Promise<{ data: { session: unknown } }>;
  navigate: (to: string, options: { replace: boolean }) => void;
}

/**
 * Returns true when it sent the user to sign in, so the page must stop.
 * Returns false when a session exists, or when the return path cannot be saved.
 * In the second case the page continues, and the callback answers 401 or 403
 * with a clear message, so sign-in never strands the user on the home page.
 */
export async function redirectToSignInIfSignedOut(params: RedirectToSignInParams): Promise<boolean> {
  let session: unknown = null;
  try {
    ({ session } = (await params.getSession()).data);
  } catch {
    // No readable session: the same as signed out.
  }
  if (session) return false;

  if (!savePosCallbackReturnPath(params.provider, params.code, params.state)) return false;
  params.navigate('/auth', { replace: true });
  return true;
}
