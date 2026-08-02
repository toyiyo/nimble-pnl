import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RolePicker } from '@/components/roles/RolePicker';

const mockUseRoles = vi.fn();
vi.mock('@/hooks/useRoles', () => ({ useRoles: (...a: unknown[]) => mockUseRoles(...a) }));

const mutate = vi.fn();
vi.mock('@/hooks/useAssignRole', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAssignRole')>('@/hooks/useAssignRole');
  return { ...actual, useAssignRole: () => ({ mutate, isPending: false }) };
});

const roleRow = (over: Record<string, unknown>) => ({
  id: 'x', restaurant_id: 'r1', name: 'Role', description: null,
  flavor: 'collaborator', builtin: false, legacy_role: null,
  created_at: '', role_areas: [], role_flags: [], memberCount: 0, ...over,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const base = {
  membershipId: 'm1', restaurantId: 'r1', personName: 'Dana Reyes',
  currentRole: 'staff', currentRoleId: null, callerRole: 'owner' as const,
};

describe('RolePicker', () => {
  beforeEach(() => { mockUseRoles.mockReset(); mutate.mockReset(); });

  it("the trigger's accessible name contains its visible text (WCAG 2.5.3)", () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });
    render(<RolePicker {...base} />, { wrapper });

    const trigger = screen.getByRole('combobox', { name: /Dana Reyes/i });
    const visible = trigger.textContent ?? '';
    expect(visible.trim().length).toBeGreaterThan(0);
    expect(trigger.getAttribute('aria-label')).toContain(visible.trim());
    expect(trigger.getAttribute('aria-label')).toContain('Change role');
  });

  it('shows a loading state while roles resolve', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: true, error: null });
    render(<RolePicker {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    expect(screen.getByText(/loading roles/i)).toBeInTheDocument();
  });

  it('shows an error state distinctly from an empty one', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: new Error('boom') });
    render(<RolePicker {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    // Not "no roles found" — a load failure must never read as emptiness.
    expect(screen.getByText(/couldn't load roles/i)).toBeInTheDocument();
    expect(screen.queryByText(/no roles found/i)).not.toBeInTheDocument();
  });

  it('hides owner from a manager and shows it to an owner', async () => {
    // A builtin Owner row, as useRoles would actually return it (global,
    // restaurant_id null) — needed so the assertion has something to find
    // when callerRole is 'owner' and getInvitableRoles includes 'owner'.
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'owner-role', name: 'Owner', legacy_role: 'owner', builtin: true, restaurant_id: null })],
      isLoading: false, error: null,
    });

    const { unmount } = render(<RolePicker {...base} callerRole="manager" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    expect(screen.queryByRole('option', { name: /^Owner/ })).not.toBeInTheDocument();
    unmount();

    render(<RolePicker {...base} callerRole="owner" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Owner/ })).toBeInTheDocument());
  });

  it('lists a custom role and assigns it with both role and roleId', async () => {
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'c1', name: 'Operations Lead' })],
      isLoading: false, error: null,
    });
    render(<RolePicker {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/ }));
    await userEvent.click(screen.getByRole('button', { name: /change role to/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: 'm1', role: 'collaborator_custom', roleId: 'c1' }),
      expect.anything()
    );
  });

  it('says so plainly when two roles grant the same thing', async () => {
    mockUseRoles.mockReturnValue({
      roles: [
        roleRow({ id: 'c1', name: 'Twin A', role_areas: [{ area_key: 'recipes', level: 'view' }] }),
        roleRow({ id: 'c2', name: 'Twin B', role_areas: [{ area_key: 'recipes', level: 'view' }] }),
      ],
      isLoading: false, error: null,
    });
    render(<RolePicker {...base} currentRole="collaborator_custom" currentRoleId="c1" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Twin B/ }));
    expect(screen.getByText(/same access/i)).toBeInTheDocument();
  });
});
