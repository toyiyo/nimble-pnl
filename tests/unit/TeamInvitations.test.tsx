/**
 * TeamInvitations – focused on role-gating, dynamic dropdown, and loading skeleton.
 *
 * Supabase client is mocked so no real network calls occur.
 * The `select()` chain returns an empty invitation list so we can test
 * the "can manage invites / which roles appear" surface in isolation.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ------------------------------------------------------------------
// Mock supabase BEFORE importing the component (hoisting requirement).
// The mock must expose a chainable builder for .from().select().eq()...
// ------------------------------------------------------------------
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

// Also mock useToast to avoid unrelated render issues
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock only the useRestaurantMembers hook (the React Query call); keep
// findMemberByEmail real since it's a pure function and is exactly the
// logic under test in the "blocking" describe block below.
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

// Also mock useAccountlessEmployees (React Query call) — not the focus of
// this test file, so default to an empty roster throughout.
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

describe('TeamInvitations – role-scoped dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chainable mocks to the default (empty list)
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        order: mockOrder,
      }),
      in: mockIn.mockResolvedValue({ data: [], error: null }),
    });
  });

  it('shows Send Invitation button for operations_manager (canManageInvites=true)', () => {
    renderInvitations('operations_manager');
    // canManageInvites is true because invitableRoles.length > 0
    expect(screen.getByRole('button', { name: /send invitation/i })).toBeDefined();
  });

  it('hides Send Invitation button for staff (canManageInvites=false)', () => {
    renderInvitations('staff');
    expect(screen.queryByRole('button', { name: /send invitation/i })).toBeNull();
  });

  it('hides Send Invitation button for chef (canManageInvites=false)', () => {
    renderInvitations('chef');
    expect(screen.queryByRole('button', { name: /send invitation/i })).toBeNull();
  });

  it('shows Skeleton loading elements (not plain text) while fetching', () => {
    // The component starts in loading=true state before the async fetch settles.
    renderInvitations('owner');
    // The Skeleton div has animate-pulse class; plain text "Loading invitations..."
    // must NOT appear (it was replaced by Skeleton blocks).
    expect(screen.queryByText(/loading invitations/i)).toBeNull();
    // At least one animate-pulse element should be present
    const pulses = document.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });
});

describe('TeamInvitations – owner invite dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        order: mockOrder,
      }),
      in: mockIn.mockResolvedValue({ data: [], error: null }),
    });
  });

  it('opens invite dialog and shows Owner option for owner', async () => {
    const user = userEvent.setup();
    renderInvitations('owner');

    // Open the dialog
    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    // The Select trigger should be present (role field)
    expect(screen.getByRole('combobox')).toBeDefined();

    // Open the combobox to reveal options
    await user.click(screen.getByRole('combobox'));
    // owner can invite owner, manager, operations_manager, chef, staff
    expect(screen.getByRole('option', { name: /owner/i })).toBeDefined();
    // The internal role and the collaborator role have DISTINCT labels, so an
    // exact-match query on the label span resolves each unambiguously
    // (regression guard for the duplicate-"Operations Manager" dropdown bug).
    // Queried by label text, not accessible name: an option's name also
    // includes its description span.
    expect(screen.getByText('Operations Manager')).toBeInTheDocument();
    expect(screen.getByText('Operations Manager (Collaborator)')).toBeInTheDocument();
  });

  it('opens invite dialog for operations_manager and shows only the Employee (self-service) option', async () => {
    const user = userEvent.setup();
    renderInvitations('operations_manager');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.click(screen.getByRole('combobox'));

    // Only "Employee (self-service)" (the renamed 'staff' role) should appear
    // (getInvitableRoles('operations_manager') = ['staff'])
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toMatch(/employee \(self-service\)/i);

    // Manager and Owner must NOT appear
    expect(screen.queryByRole('option', { name: /manager/i })).toBeNull();
    expect(screen.queryByRole('option', { name: /owner/i })).toBeNull();
  });

  it('opens invite dialog for manager and does NOT show Owner option', async () => {
    const user = userEvent.setup();
    renderInvitations('manager');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.click(screen.getByRole('combobox'));

    // manager cannot invite owner
    expect(screen.queryByText('Owner')).toBeNull();
    // but can invite operations_manager (exact label match — distinct from the collaborator)
    expect(screen.getByText('Operations Manager')).toBeInTheDocument();
  });

  it('groups roles by access type so platform access reads differently from self-service', async () => {
    const user = userEvent.setup();
    renderInvitations('owner');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByText('Platform access (EasyShiftHQ)')).toBeInTheDocument();
    expect(screen.getByText('Employee self-service')).toBeInTheDocument();
    expect(screen.getByText('External collaborators')).toBeInTheDocument();
  });

  it('shows what each role can actually do next to its name', async () => {
    const user = userEvent.setup();
    renderInvitations('owner');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.click(screen.getByRole('combobox'));

    expect(
      await screen.findByText('Clock in/out, view their own schedule, request time off')
    ).toBeInTheDocument();
  });

  it('shows only the role label in the closed trigger, not its description', async () => {
    // Regression guard: ui/select.tsx wraps a SelectItem's whole children in
    // ItemText, so a childless <SelectValue /> portals label AND description
    // into the line-clamped trigger.
    const user = userEvent.setup();
    renderInvitations('owner');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    const trigger = screen.getByRole('combobox', { name: /role/i });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /employee \(self-service\)/i }));

    expect(trigger).toHaveTextContent('Employee (self-service)');
    expect(trigger).not.toHaveTextContent('Clock in/out');
  });
});

describe('TeamInvitations – blocking invites to existing members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        order: mockOrder,
      }),
      in: mockIn.mockResolvedValue({ data: [], error: null }),
    });
    // Default: nobody on the roster matches — every test below overrides
    // this when it needs an existing member (or a lookup error).
    mockUseRestaurantMembers.mockReturnValue({ data: [], isError: false });
  });

  it('blocks and explains when the email already belongs to a team member', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [
        { userId: 'u1', email: 'alexis@rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
      ],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'alexis@rushbowls.com');

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/already on your team as Manager/i);

    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    // Must stay focusable — a natively disabled button leaves the tab order
    // and announces nothing, stranding keyboard users.
    expect(send).not.toHaveAttribute('disabled');

    await user.click(send);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('describes the email field with the explanation panel', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [
        { userId: 'u1', email: 'alexis@rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
      ],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'alexis@rushbowls.com');

    const panel = await screen.findByRole('status');
    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput.getAttribute('aria-describedby')).toBe(panel.id);
  });

  it('sends normally for an email that is not already a member', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [
        { userId: 'u1', email: 'someoneelse@rushbowls.com', fullName: 'Someone Else', role: 'manager' },
      ],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'new@example.com');

    const send = screen.getByRole('button', { name: /send invitation/i });
    await user.click(send);

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'send-team-invitation',
      expect.objectContaining({ body: expect.objectContaining({ email: 'new@example.com' }) })
    );
  });

  it('fails open when the roster lookup errors', async () => {
    // undefined data (still-loading or failed) — findMemberByEmail treats
    // this as "proceed normally" per its own contract.
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isError: true });

    const user = userEvent.setup();
    renderInvitations('owner');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.type(screen.getByLabelText(/email address/i), 'alexis@rushbowls.com');

    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).not.toHaveAttribute('aria-disabled', 'true');
  });
});
