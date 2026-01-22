import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { TipPoolSettingsDialog } from '@/components/tips/TipPoolSettingsDialog';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Employee } from '@/types/scheduling';

const mockEmployees: Employee[] = [
  {
    id: '1',
    name: 'John Server',
    position: 'Server',
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: 1500,
    tip_eligible: true,
  } as Employee,
  {
    id: '2',
    name: 'Jane Bartender',
    position: 'Bartender',
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: 1800,
    tip_eligible: true,
  } as Employee,
];

describe('TipPoolSettingsDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    tipSource: 'manual' as const,
    shareMethod: 'hours' as const,
    splitCadence: 'daily' as const,
    roleWeights: { Server: 1, Bartender: 1 },
    selectedEmployees: new Set(['1', '2']),
    eligibleEmployees: mockEmployees,
    onTipSourceChange: vi.fn(),
    onShareMethodChange: vi.fn(),
    onSplitCadenceChange: vi.fn(),
    onRoleWeightsChange: vi.fn(),
    onSelectedEmployeesChange: vi.fn(),
  };

  it('renders the dialog with title', () => {
    render(<TipPoolSettingsDialog {...defaultProps} />);
    expect(screen.getByText('Tip Pool Settings')).toBeInTheDocument();
  });

  it('shows tip source options', () => {
    render(<TipPoolSettingsDialog {...defaultProps} />);
    expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    expect(screen.getByText('POS Import')).toBeInTheDocument();
  });

  it('shows share method options', () => {
    render(<TipPoolSettingsDialog {...defaultProps} />);
    expect(screen.getByText('By Hours Worked')).toBeInTheDocument();
    expect(screen.getByText('By Role')).toBeInTheDocument();
    expect(screen.getByText('Even Split')).toBeInTheDocument();
  });

  it('shows split cadence options', () => {
    render(<TipPoolSettingsDialog {...defaultProps} />);
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Per Shift')).toBeInTheDocument();
  });

  it('shows participating employees', () => {
    render(<TipPoolSettingsDialog {...defaultProps} />);
    expect(screen.getByText('John Server')).toBeInTheDocument();
    expect(screen.getByText('Jane Bartender')).toBeInTheDocument();
  });

  it('calls onClose when Done is clicked', () => {
    const onClose = vi.fn();
    render(<TipPoolSettingsDialog {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows role weights when share method is role', () => {
    render(<TipPoolSettingsDialog {...defaultProps} shareMethod="role" />);
    expect(screen.getByText('Role Weights')).toBeInTheDocument();
  });

  it('hides role weights when share method is not role', () => {
    render(<TipPoolSettingsDialog {...defaultProps} shareMethod="hours" />);
    expect(screen.queryByText('Role Weights')).not.toBeInTheDocument();
  });

  it('shows employee count', () => {
    render(<TipPoolSettingsDialog {...defaultProps} />);
    expect(screen.getByText('2 of 2 employees selected')).toBeInTheDocument();
  });

  it('calls onSelectedEmployeesChange when Select None is clicked', () => {
    const onSelectedEmployeesChange = vi.fn();
    render(
      <TipPoolSettingsDialog
        {...defaultProps}
        onSelectedEmployeesChange={onSelectedEmployeesChange}
      />
    );

    fireEvent.click(screen.getByText('Select None'));
    expect(onSelectedEmployeesChange).toHaveBeenCalledWith(new Set());
  });
});
