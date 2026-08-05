import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RoleSelect } from '@/components/roles/RoleSelect';

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
  restaurantId: 'r1',
  callerRole: 'owner' as const,
  value: null,
  onSelect: vi.fn(),
  triggerLabel: 'Dana Reyes: role is Staff. Change role',
  triggerText: 'Staff',
};

describe('RoleSelect', () => {
  beforeEach(() => { mockUseRoles.mockReset(); mutate.mockReset(); });

  it("the trigger's accessible name contains its visible text (WCAG 2.5.3)", () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });
    render(<RoleSelect {...base} />, { wrapper });

    const trigger = screen.getByRole('combobox');
    const visible = trigger.textContent ?? '';
    expect(visible.trim().length).toBeGreaterThan(0);
    expect(trigger.getAttribute('aria-label')).toContain(visible.trim());
  });

  it('shows a loading state with role="status" while roles resolve', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: true, error: null });
    render(<RoleSelect {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/loading roles/i);
  });

  it("shows an error state distinctly from the empty-state copy", async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: new Error('boom') });
    render(<RoleSelect {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText(/couldn't load roles/i)).toBeInTheDocument();
    expect(screen.queryByText(/no roles match/i)).not.toBeInTheDocument();
  });

  it('waits rather than claiming no roles exist when there is no restaurant yet', async () => {
    // useRoles is `enabled: !!restaurantId`, and a disabled React Query reports
    // isLoading === false — so the empty state has to check restaurantId too or
    // it renders "No roles match" directly under "Loading roles…".
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });
    render(<RoleSelect {...base} restaurantId="" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByRole('status')).toHaveTextContent(/loading roles/i);
    expect(screen.queryByText(/no roles match/i)).not.toBeInTheDocument();
  });

  it('hides owner from a manager and shows it to an owner', async () => {
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'owner-role', name: 'Owner', legacy_role: 'owner', builtin: true, restaurant_id: null })],
      isLoading: false, error: null,
    });

    const { unmount } = render(<RoleSelect {...base} callerRole="manager" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: /^Owner/ })).not.toBeInTheDocument();
    unmount();

    render(<RoleSelect {...base} callerRole="owner" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByRole('option', { name: /Owner/ })).toBeInTheDocument());
  });

  it('never offers a custom role scoped to another restaurant', async () => {
    mockUseRoles.mockReturnValue({
      roles: [
        roleRow({ id: 'ok', name: 'Operations lead', restaurant_id: 'r1' }),
        roleRow({ id: 'other', name: 'Other Restaurant Custom', restaurant_id: 'r2' }),
      ],
      isLoading: false, error: null,
    });
    render(<RoleSelect {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: /Operations lead/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Other Restaurant Custom/ })).not.toBeInTheDocument();
  });

  it('shows the custom group with a reason, not hidden, when the caller may not assign one', async () => {
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'c1', name: 'Operations Lead', restaurant_id: 'r1' })],
      isLoading: false, error: null,
    });
    render(<RoleSelect {...base} callerRole="chef" />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText(/Only an owner or manager can assign a custom role/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Operations Lead/ })).not.toBeInTheDocument();
  });

  it('fires onSelect with the whole role and never touches useAssignRole', async () => {
    const onSelect = vi.fn();
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'c1', name: 'Operations Lead', restaurant_id: 'r1' })],
      isLoading: false, error: null,
    });
    render(<RoleSelect {...base} onSelect={onSelect} />, { wrapper });
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'Operations Lead' }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('renders the footer inside the popover but not as an option', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });
    render(
      <RoleSelect {...base} footer={<div data-testid="footer-content">Footer</div>} />,
      { wrapper }
    );
    await userEvent.click(screen.getByRole('combobox'));

    const footer = await screen.findByTestId('footer-content');
    expect(footer).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Footer/ })).not.toBeInTheDocument();
  });

  it('reopens unfiltered after the caller closes it itself', async () => {
    mockUseRoles.mockReturnValue({
      roles: [
        roleRow({ id: 'c1', name: 'Operations Lead', restaurant_id: 'r1' }),
        roleRow({ id: 'c2', name: 'Pastry Lead', restaurant_id: 'r1' }),
      ],
      isLoading: false, error: null,
    });

    // Both real call sites drive `open` themselves — RolePicker closes in
    // onSuccess, the invite pickers close on select — so Radix's onOpenChange
    // never fires on the way out. Clearing there would leak the last search
    // into the next open.
    const { rerender } = render(
      <RoleSelect {...base} open onOpenChange={vi.fn()} />, { wrapper }
    );
    await userEvent.type(await screen.findByPlaceholderText(/search roles/i), 'Pastry');
    expect(screen.queryByRole('option', { name: /Operations Lead/ })).not.toBeInTheDocument();

    rerender(<RoleSelect {...base} open={false} onOpenChange={vi.fn()} />);
    rerender(<RoleSelect {...base} open onOpenChange={vi.fn()} />);

    expect(await screen.findByPlaceholderText(/search roles/i)).toHaveValue('');
    expect(await screen.findByRole('option', { name: /Operations Lead/ })).toBeInTheDocument();
  });
});
