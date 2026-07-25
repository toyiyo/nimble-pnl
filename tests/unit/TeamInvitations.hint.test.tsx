/**
 * TeamInvitations – accountless-employee "will link" inform panel.
 *
 * Precedence under test: existing member (block) beats accountless-employee
 * (inform hint) beats normal. The hint must also stay suppressed while the
 * members query hasn't settled yet, so it never flashes before a block that
 * lands a moment later (both queries fail open to null while loading).
 *
 * Supabase client is mocked so no real network calls occur.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          order: mockOrder.mockResolvedValue({ data: [], error: null }),
        }),
        in: mockIn.mockResolvedValue({ data: [], error: null }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    })),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Keep findMemberByEmail / findAccountlessEmployeeByEmail real (pure
// functions, exactly the precedence logic under test); mock only the React
// Query hooks themselves.
const mockUseRestaurantMembers = vi.fn(() => ({ data: [], isLoading: false, isError: false }));
vi.mock('@/hooks/useRestaurantMembers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useRestaurantMembers')>(
    '@/hooks/useRestaurantMembers'
  );
  return {
    ...actual,
    useRestaurantMembers: (...args: unknown[]) => mockUseRestaurantMembers(...args),
  };
});

const mockUseAccountlessEmployees = vi.fn(() => ({ data: [], isLoading: false, isError: false }));
vi.mock('@/hooks/useAccountlessEmployees', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAccountlessEmployees')>(
    '@/hooks/useAccountlessEmployees'
  );
  return {
    ...actual,
    useAccountlessEmployees: (...args: unknown[]) => mockUseAccountlessEmployees(...args),
  };
});

import { supabase } from '@/integrations/supabase/client';
import { TeamInvitations } from '@/components/TeamInvitations';

const RESTAURANT_ID = 'rest-123';

function renderInvitations(userRole: string) {
  return render(
    // cast needed: test helper accepts arbitrary strings for negative-path tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <TeamInvitations restaurantId={RESTAURANT_ID} userRole={userRole as any} />
  );
}

describe('TeamInvitations – accountless-employee inform hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        order: mockOrder,
      }),
      in: mockIn.mockResolvedValue({ data: [], error: null }),
    });
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('shows the member block, not the hint, when the email matches both an existing member and an accountless employee', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [
        { userId: 'u1', email: 'alexis@rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
      ],
      isLoading: false,
      isError: false,
    });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [
        { id: 'emp-1', name: 'Alexis Sanchez', email: 'alexis@rushbowls.com' },
      ],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'alexis@rushbowls.com');

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/already on your team as Manager/i);
    expect(screen.queryByText(/is already set up for scheduling here/i)).toBeNull();
    // Only one status panel — the block, not both.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('suppresses the hint while the members query is still loading, even if the accountless query already resolved', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [
        { id: 'emp-1', name: 'Jordan Lee', email: 'jordan@rushbowls.com' },
      ],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'jordan@rushbowls.com');

    expect(screen.queryByText(/is already set up for scheduling here/i)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('suppresses the hint and omits employeeId when the members query errors, even with an accountless match', async () => {
    // An errored member lookup means we don't actually know whether this
    // email belongs to an existing member — unlike a settled "no match"
    // result. The hint must fail closed here (not surface a possibly-wrong
    // claim, and not attach employeeId to the invite body), even though the
    // accountless-employees roster itself resolved with a match.
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [
        { id: 'emp-1', name: 'Jordan Lee', email: 'jordan@rushbowls.com' },
      ],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'jordan@rushbowls.com');

    expect(screen.queryByText(/is already set up for scheduling here/i)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(send);

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'send-team-invitation',
      expect.objectContaining({
        body: expect.not.objectContaining({
          employeeId: expect.anything(),
        }),
      })
    );
  });

  it('shows the inform hint, keeps Send enabled, and includes employeeId in the send body for an accountless-only match', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [
        { id: 'emp-1', name: 'Jordan Lee', email: 'jordan@rushbowls.com' },
      ],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'jordan@rushbowls.com');

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/Jordan Lee/);
    expect(panel).toHaveTextContent(/is already set up for scheduling here/i);

    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).not.toHaveAttribute('aria-disabled', 'true');
    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput.getAttribute('aria-describedby')).toBe(panel.id);

    await user.click(send);

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'send-team-invitation',
      expect.objectContaining({
        body: expect.objectContaining({
          email: 'jordan@rushbowls.com',
          employeeId: 'emp-1',
        }),
      })
    );
  });

  it('describes the email field with both the accountless hint and a stacked pending-conflict warning', async () => {
    // A pending invite for the same email as the accountless match — the two
    // panels are independent (not either/or) and both must be announced.
    // Overriding supabase.from directly (rather than the shared
    // mockSelect/mockEq/mockOrder chain) because that chain's `from`
    // implementation rebuilds itself — and re-defaults mockOrder to `[]` —
    // on every call, clobbering any override made before render.
    vi.mocked(supabase.from)
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('invitations');
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'inv-1',
                      email: 'jordan@rushbowls.com',
                      role: 'staff',
                      status: 'pending',
                      created_at: '2026-01-01T00:00:00Z',
                      expires_at: null,
                      invited_by: 'u1',
                      employee_id: null,
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('profiles');
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [{ user_id: 'u1', full_name: 'Owner' }], error: null }),
          }),
        };
      });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [{ id: 'emp-1', name: 'Jordan Lee', email: 'jordan@rushbowls.com' }],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    // Let the invitations fetch (drives hasConflict) fully settle — the
    // fetched invitation rendering in the list is proof setInvitations ran.
    await screen.findByText('jordan@rushbowls.com');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'jordan@rushbowls.com');
    await screen.findByText(/is already set up for scheduling here/i);

    // First click surfaces the pending-conflict warning instead of sending.
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await screen.findByText(/already exists\. Sending a new one will cancel the old link/i);

    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput.getAttribute('aria-describedby')).toBe(
      'invite-existing-employee-hint invite-pending-conflict-warning'
    );
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
