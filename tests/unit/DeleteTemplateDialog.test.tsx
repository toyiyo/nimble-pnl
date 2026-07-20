import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const impactMock = vi.fn();
vi.mock('@/hooks/useTemplateDeletionImpact', () => ({
  useTemplateDeletionImpact: (...args: unknown[]) => impactMock(...args),
}));

import { DeleteTemplateDialog } from '@/components/scheduling/DeleteTemplateDialog';
import type { ShiftTemplate } from '@/types/scheduling';

const template: ShiftTemplate = {
  id: 'tmpl-1',
  restaurant_id: 'rest-1',
  name: 'Closing Server',
  days: [1, 3, 5],
  start_time: '16:00',
  end_time: '23:00',
  break_duration: 30,
  position: 'Server',
  capacity: 1,
  is_active: true,
  created_at: '',
  updated_at: '',
};

function baseImpact(overrides: Partial<ReturnType<typeof impactMock>> = {}) {
  return {
    pendingClaims: { count: 0, names: [] },
    scheduledShiftsKept: 0,
    upcomingOpenSpots: 0,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

const onOpenChange = vi.fn();
const onHide = vi.fn();
const onConfirmDelete = vi.fn();

function renderDialog(props: Partial<React.ComponentProps<typeof DeleteTemplateDialog>> = {}) {
  return render(
    <DeleteTemplateDialog
      open={true}
      onOpenChange={onOpenChange}
      template={template}
      restaurantId="rest-1"
      onHide={onHide}
      onConfirmDelete={onConfirmDelete}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  impactMock.mockReturnValue(baseImpact());
});

describe('DeleteTemplateDialog', () => {
  it('renders nothing when there is no template selected', () => {
    impactMock.mockReturnValue(baseImpact());
    const { container } = renderDialog({ template: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('passes restaurantId and template id to the impact hook while open', () => {
    impactMock.mockReturnValue(baseImpact());
    renderDialog();
    expect(impactMock).toHaveBeenCalledWith('rest-1', 'tmpl-1');
  });

  it('passes a null templateId to the impact hook when closed, so the query stays disabled', () => {
    impactMock.mockReturnValue(baseImpact());
    renderDialog({ open: false });
    expect(impactMock).toHaveBeenCalledWith('rest-1', null);
  });

  it('shows the loading state and keeps Delete disabled while impact is checking', () => {
    impactMock.mockReturnValue(baseImpact({ isLoading: true }));
    renderDialog();

    expect(screen.getByText(/checking impact/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete template/i })).toBeDisabled();
  });

  it('shows an error row with Retry and keeps Delete disabled on impact error', async () => {
    const refetch = vi.fn();
    impactMock.mockReturnValue(
      baseImpact({ error: new Error('network down'), refetch }),
    );
    renderDialog();

    expect(screen.getByRole('button', { name: /delete template/i })).toBeDisabled();
    const retryButton = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(retryButton);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('low impact: no ack checkbox, low pill, and Delete is enabled once loaded', () => {
    impactMock.mockReturnValue(
      baseImpact({
        pendingClaims: { count: 0, names: [] },
        scheduledShiftsKept: 2,
      }),
    );
    renderDialog();

    expect(screen.getByText(/low impact/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete template/i })).toBeEnabled();
    // Kept panel renders since scheduledShiftsKept > 0.
    expect(screen.getByText(/already-scheduled shifts stay on the calendar/i)).toBeInTheDocument();
  });

  it('high impact: renders ack checkbox + claimant names and gates Delete until checked', async () => {
    impactMock.mockReturnValue(
      baseImpact({
        pendingClaims: { count: 2, names: ['Alex Rivera', 'Jordan Lee'] },
      }),
    );
    renderDialog();

    expect(screen.getByText(/high impact/i)).toBeInTheDocument();
    expect(screen.getByText(/Alex Rivera & Jordan Lee/)).toBeInTheDocument();

    const deleteButton = screen.getByRole('button', { name: /delete template/i });
    expect(deleteButton).toBeDisabled();

    const checkbox = screen.getByRole('checkbox', {
      name: /i understand 2 employees' pending claims will be withdrawn/i,
    });
    await userEvent.click(checkbox);
    expect(deleteButton).toBeEnabled();
  });

  it('calls onConfirmDelete with id, name, and pendingClaimsCount when Delete is clicked', async () => {
    impactMock.mockReturnValue(baseImpact({ pendingClaims: { count: 0, names: [] } }));
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: /delete template/i }));
    expect(onConfirmDelete).toHaveBeenCalledWith({
      id: 'tmpl-1',
      name: 'Closing Server',
      pendingClaimsCount: 0,
    });
  });

  it('calls onHide with the template when Hide template is clicked', async () => {
    impactMock.mockReturnValue(baseImpact());
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: /hide template/i }));
    expect(onHide).toHaveBeenCalledWith(template);
  });

  it('control-group gating: disables both Delete and Hide while either mutation is pending', () => {
    impactMock.mockReturnValue(baseImpact());
    renderDialog({ isDeleting: true, isHiding: false });

    expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /hide template/i })).toBeDisabled();
  });

  it('control-group gating: hiding also disables Delete', () => {
    impactMock.mockReturnValue(baseImpact());
    renderDialog({ isDeleting: false, isHiding: true });

    expect(screen.getByRole('button', { name: /delete template/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /hiding/i })).toBeDisabled();
  });

  it('has a11y wiring: DialogTitle names the template and checkbox has an associated label', () => {
    impactMock.mockReturnValue(
      baseImpact({ pendingClaims: { count: 1, names: ['Alex Rivera'] } }),
    );
    renderDialog();

    expect(screen.getByRole('heading', { name: /delete "closing server"\?/i })).toBeInTheDocument();
    // getByRole with an accessible name proves the <Checkbox>/<Label> pairing works.
    expect(
      screen.getByRole('checkbox', { name: /i understand 1 employee's pending claim will be withdrawn/i }),
    ).toBeInTheDocument();
  });

  it('does not render the Kept panel when there are no scheduled shifts to keep', () => {
    impactMock.mockReturnValue(baseImpact({ scheduledShiftsKept: 0 }));
    renderDialog();

    expect(screen.queryByText(/already-scheduled shifts stay on the calendar/i)).not.toBeInTheDocument();
  });

  it('shows the safe-alternative callout referencing Hide', () => {
    impactMock.mockReturnValue(baseImpact());
    renderDialog();

    expect(screen.getByText(/hide it instead/i)).toBeInTheDocument();
  });
});
