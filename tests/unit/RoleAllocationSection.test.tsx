import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleAllocationSection } from '@/components/tips/RoleAllocationSection';

describe('RoleAllocationSection', () => {
  const roles = ['Manager', 'Server', 'Busser'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a row per role', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('Busser')).toBeInTheDocument();
  });

  it('labels each mode control for screen readers', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Manager allocation mode')).toBeInTheDocument();
  });

  it('hides the percentage input for roles with no rule', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.queryByLabelText('Manager percentage')).not.toBeInTheDocument();
  });

  it('shows the percentage input when a rule is set', () => {
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{ Manager: { mode: 'at_least', percentage: 10 } }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Manager percentage')).toHaveValue(10);
  });

  it('emits a rule when a mode is chosen', () => {
    const onChange = vi.fn();
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Manager: at least a set percentage' }));

    expect(onChange).toHaveBeenCalledWith({ Manager: { mode: 'at_least', percentage: 10 } });
  });

  it('removes the rule when the mode returns to by hours', () => {
    const onChange = vi.fn();
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{ Manager: { mode: 'at_least', percentage: 10 } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Manager: by hours' }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('clamps the percentage to 0-100', () => {
    const onChange = vi.fn();
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{ Manager: { mode: 'exactly', percentage: 10 } }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Manager percentage'), { target: { value: '150' } });
    expect(onChange).toHaveBeenCalledWith({ Manager: { mode: 'exactly', percentage: 100 } });

    fireEvent.change(screen.getByLabelText('Manager percentage'), { target: { value: '-5' } });
    expect(onChange).toHaveBeenCalledWith({ Manager: { mode: 'exactly', percentage: 0 } });
  });

  it('summarises configured rules per person', () => {
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{
          Manager: { mode: 'at_least', percentage: 10 },
          Server: { mode: 'exactly', percentage: 15 },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('10% + 15% per person on these roles')).toBeInTheDocument();
  });

  it('warns when configured percentages exceed 100', () => {
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{
          Manager: { mode: 'exactly', percentage: 60 },
          Server: { mode: 'exactly', percentage: 60 },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Over 100% — guarantees will be scaled down proportionally on days they don't fit.",
      ),
    ).toBeInTheDocument();
  });

  it('shows nothing in the footer when no rules are configured', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.queryByText(/per person on these roles/)).not.toBeInTheDocument();
  });
});
