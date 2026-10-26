/**
 * signupWithInvitationHandler.ts
 *
 * Injectable handler for the signup-with-invitation edge function.
 *
 * The function runs with verify_jwt = false, so it must never change an
 * existing account. It only calls auth.admin.createUser. GoTrue checks the
 * email over all users and without case. When GoTrue reports that the email
 * is already registered, the handler returns 409 `account_exists` and the
 * account does not change. That user signs in and calls accept-invitation.
 *
 * Design ref: docs/superpowers/specs/2026-10-26-signup-invitation-no-takeover-design.md
 */

export interface SignupRequest {
  email: string;
  password: string;
  fullName: string;
  token: string;
}

interface AuthErrorLike {
  message: string;
  code?: string;
  status?: number;
}

interface QueryResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

/** A PostgREST filter chain: .eq(...) any number of times, then .single(). */
interface FilterChain {
  eq(column: string, value: string): FilterChain;
  single(): PromiseLike<QueryResult>;
}

/** The part of the service-role client that the handler uses. */
export interface SignupWithInvitationAdmin {
  from(table: string): { select(columns: string): FilterChain };
  auth: {
    admin: {
      createUser(attributes: {
        email: string;
        password: string;
        user_metadata: Record<string, unknown>;
        email_confirm: boolean;
      }): Promise<{ data: { user: { id: string } | null }; error: AuthErrorLike | null }>;
    };
  };
}

export interface SignupResult {
  status: number;
  body: {
    success: boolean;
    code?: string;
    error?: string;
    message?: string;
  };
}

export const ACCOUNT_EXISTS_CODE = 'account_exists';
export const ACCOUNT_EXISTS_MESSAGE = 'Sign in to accept this invitation.';

const ALREADY_REGISTERED_CODES = new Set(['email_exists', 'user_already_exists']);
const ALREADY_REGISTERED_MESSAGE_RE = /already (been )?registered/i;

/** True when a createUser error means that the email already has an account. */
export function isEmailAlreadyRegisteredError(error: AuthErrorLike): boolean {
  if (error.code && ALREADY_REGISTERED_CODES.has(error.code)) return true;
  return ALREADY_REGISTERED_MESSAGE_RE.test(error.message ?? '');
}

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function failure(status: number, error: string, code?: string): SignupResult {
  return { status, body: code ? { success: false, code, error } : { success: false, error } };
}

export async function handleSignupWithInvitation(
  admin: SignupWithInvitationAdmin,
  request: Partial<SignupRequest> | null,
): Promise<SignupResult> {
  const { email, password, fullName, token } = request ?? {};
  if (!email || !password || !token) {
    return failure(400, 'Email, password, and invitation token are required');
  }

  // The database stores the SHA-256 hex of the token.
  const hashedToken = await sha256Hex(token);

  const { data: invitation, error: inviteError } = await admin
    .from('invitations')
    .select('id, restaurant_id, email, expires_at')
    .eq('token', hashedToken)
    .eq('status', 'pending')
    .eq('email', email)
    .single();

  if (inviteError || !invitation) {
    console.error('Invalid invitation:', inviteError?.message);
    return failure(400, 'Invalid or expired invitation');
  }

  // A value that does not parse counts as expired.
  const expiresAt = new Date(invitation.expires_at as string).getTime();
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
    console.error('Invitation expired:', invitation.id);
    return failure(400, 'Invitation has expired');
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name: fullName },
    email_confirm: true,
  });

  if (authError) {
    if (isEmailAlreadyRegisteredError(authError)) {
      console.log('Signup refused, account exists for invitation:', invitation.id);
      return failure(409, ACCOUNT_EXISTS_MESSAGE, ACCOUNT_EXISTS_CODE);
    }
    console.error('Error creating user:', authError.message);
    return failure(400, authError.message);
  }

  console.log('User created for invitation:', invitation.id, authData.user?.id);

  const { data: restaurant } = await admin
    .from('restaurants')
    .select('name')
    .eq('id', invitation.restaurant_id as string)
    .single();

  return {
    status: 200,
    body: {
      success: true,
      message: `Welcome to ${restaurant?.name || 'the team'}! Please sign in with your new account.`,
    },
  };
}
