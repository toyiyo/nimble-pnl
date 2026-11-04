/**
 * signupWithInvitationHandler.test.ts
 *
 * The handler must never change an existing account. An email that already
 * has an account gets 409 `account_exists`, and the handler does not call
 * `updateUserById` or `listUsers`. Security audit fix 1 of 7.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleSignupWithInvitation,
  isEmailAlreadyRegisteredError,
  type SignupWithInvitationAdmin,
} from '../../supabase/functions/_shared/signupWithInvitationHandler';

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

const BODY = {
  email: 'victim@test.com',
  password: 'attacker-chosen',
  fullName: 'Victim Person',
  token: 'tok123',
};

interface MockOpts {
  invitation?: Record<string, unknown> | null;
  createError?: { message: string; code?: string; status?: number } | null;
}

function makeAdmin(opts: MockOpts = {}) {
  const invitation =
    opts.invitation === undefined
      ? { id: 'inv-1', restaurant_id: 'r-1', email: BODY.email, expires_at: FUTURE }
      : opts.invitation;

  const inviteSingle = vi.fn().mockResolvedValue({
    data: invitation,
    error: invitation ? null : { message: 'not found' },
  });
  const restaurantSingle = vi.fn().mockResolvedValue({
    data: { id: 'r-1', name: 'Bar Bar' },
    error: null,
  });

  // Chain for invitations: select().eq().eq().eq().single()
  const inviteEq3 = vi.fn().mockReturnValue({ single: inviteSingle });
  const inviteEq2 = vi.fn().mockReturnValue({ eq: inviteEq3 });
  const inviteEq1 = vi.fn().mockReturnValue({ eq: inviteEq2 });
  // Chain for restaurants: select().eq().single()
  const restaurantEq = vi.fn().mockReturnValue({ single: restaurantSingle });

  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnValue(
      table === 'invitations' ? { eq: inviteEq1 } : { eq: restaurantEq },
    ),
  }));

  const createUser = vi.fn().mockResolvedValue(
    opts.createError
      ? { data: { user: null }, error: opts.createError }
      : { data: { user: { id: 'new-user' } }, error: null },
  );
  const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: null });
  const listUsers = vi.fn().mockResolvedValue({
    data: { users: [{ id: 'victim-id', email: BODY.email }] },
    error: null,
  });

  const admin = {
    from,
    auth: { admin: { createUser, updateUserById, listUsers } },
  };
  return {
    admin: admin as unknown as SignupWithInvitationAdmin,
    mocks: { createUser, updateUserById, listUsers, inviteEq1, inviteEq2, inviteEq3 },
  };
}

describe('handleSignupWithInvitation', () => {
  it('returns 409 account_exists for an existing email and does not change the account', async () => {
    const { admin, mocks } = makeAdmin({
      createError: {
        message: 'A user with this email address has already been registered',
        code: 'email_exists',
        status: 422,
      },
    });

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      success: false,
      code: 'account_exists',
      error: 'Sign in to accept this invitation.',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('treats the older "User already registered" message as an existing account', async () => {
    const { admin, mocks } = makeAdmin({
      createError: { message: 'User already registered', status: 422 },
    });

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe('account_exists');
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('creates a new account with the invitation email and returns 200', async () => {
    const { admin, mocks } = makeAdmin();

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.message).toContain('Bar Bar');
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: BODY.email,
      password: BODY.password,
      user_metadata: { full_name: BODY.fullName },
      email_confirm: true,
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('looks up the invitation by the SHA-256 hash of the token, not the raw token', async () => {
    const { admin, mocks } = makeAdmin();

    await handleSignupWithInvitation(admin, BODY);

    // sha256("tok123")
    expect(mocks.inviteEq1).toHaveBeenCalledWith(
      'token',
      '4f6e1f65055263866dedb3c5fe22defb0cc045648cf0b87afac54cc6420e5647',
    );
    expect(mocks.inviteEq2).toHaveBeenCalledWith('status', 'pending');
    expect(mocks.inviteEq3).toHaveBeenCalledWith('email', BODY.email);
  });

  it('returns 400 and creates no account when the invitation does not exist', async () => {
    const { admin, mocks } = makeAdmin({ invitation: null });

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, error: 'Invalid or expired invitation' });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('returns 400 and creates no account when the invitation is expired', async () => {
    const { admin, mocks } = makeAdmin({
      invitation: { id: 'inv-1', restaurant_id: 'r-1', email: BODY.email, expires_at: PAST },
    });

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, error: 'Invitation has expired' });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('returns 400 with the GoTrue message for a different createUser error', async () => {
    const { admin, mocks } = makeAdmin({
      createError: { message: 'Password should be at least 6 characters', code: 'weak_password', status: 422 },
    });

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      error: 'Password should be at least 6 characters',
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('returns 400 and creates no account when a required field is missing', async () => {
    const { admin, mocks } = makeAdmin();

    const result = await handleSignupWithInvitation(admin, { ...BODY, token: '' });

    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe('handleSignupWithInvitation input and response edges', () => {
  it('returns 400 for a null body', async () => {
    const { admin, mocks } = makeAdmin();

    const result = await handleSignupWithInvitation(
      admin,
      null as unknown as Parameters<typeof handleSignupWithInvitation>[1],
    );

    expect(result.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('treats an expires_at that does not parse as expired', async () => {
    const { admin, mocks } = makeAdmin({
      invitation: { id: 'inv-1', restaurant_id: 'r-1', email: BODY.email, expires_at: 'not-a-date' },
    });

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invitation has expired');
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('does not send the restaurant row to the caller', async () => {
    const { admin } = makeAdmin();

    const result = await handleSignupWithInvitation(admin, BODY);

    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty('restaurant');
  });
});

describe('isEmailAlreadyRegisteredError', () => {
  it.each([
    [{ message: 'x', code: 'email_exists' }, true],
    [{ message: 'x', code: 'user_already_exists' }, true],
    [{ message: 'A user with this email address has already been registered' }, true],
    [{ message: 'User already registered' }, true],
    [{ message: 'Password should be at least 6 characters', code: 'weak_password' }, false],
    [{ message: 'Database error creating new user' }, false],
  ])('classifies %o as %s', (error, expected) => {
    expect(isEmailAlreadyRegisteredError(error)).toBe(expected);
  });
});
