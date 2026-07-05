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
    expect(screen.getByRole('option', { name: /operations manager/i })).toBeDefined();
  });

  it('opens invite dialog for operations_manager and shows only Staff option', async () => {
    const user = userEvent.setup();
    renderInvitations('operations_manager');

    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await user.click(screen.getByRole('combobox'));

    // Only "Staff" should appear (getInvitableRoles('operations_manager') = ['staff'])
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toMatch(/staff/i);

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
    expect(screen.queryByRole('option', { name: /^owner$/i })).toBeNull();
    // but can invite operations_manager
    expect(screen.getByRole('option', { name: /operations manager/i })).toBeDefined();
  });
});
