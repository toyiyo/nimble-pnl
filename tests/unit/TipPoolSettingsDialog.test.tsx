import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TipPoolSettingsDialog } from '@/components/tips/TipPoolSettingsDialog';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  {
    id: '3',
    name: 'Bob Busser',
    position: 'Busser',
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: 1200,
    tip_eligible: true,
  } as Employee,
];

describe('TipPoolSettingsDialog - Comprehensive Tests', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    poolingModel: 'full_pool' as const,
    onPoolingModelChange: vi.fn(),
    tipSource: 'manual' as const,
    shareMethod: 'hours' as const,
    splitCadence: 'daily' as const,
    roleWeights: { Server: 1, Bartender: 1, Busser: 0.5 },
    selectedEmployees: new Set(['1', '2', '3']),
    eligibleEmployees: mockEmployees,
    onTipSourceChange: vi.fn(),
    onShareMethodChange: vi.fn(),
    onSplitCadenceChange: vi.fn(),
    onRoleWeightsChange: vi.fn(),
    onSelectedEmployeesChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
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
      expect(screen.getByText('Bob Busser')).toBeInTheDocument();
    });

    it('shows employee count', () => {
      render(<TipPoolSettingsDialog {...defaultProps} />);
      expect(screen.getByText('3 of 3 employees selected')).toBeInTheDocument();
    });

    it('shows loading skeleton when isLoading is true', () => {
      render(<TipPoolSettingsDialog {...defaultProps} isLoading={true} />);
      // Should show skeleton instead of content
      expect(screen.queryByText('Manual Entry')).not.toBeInTheDocument();
    });
  });

  describe('Tip Source Selection', () => {
    it('highlights selected tip source', () => {
      render(<TipPoolSettingsDialog {...defaultProps} tipSource="manual" />);
      const manualLabel = screen.getByText('Manual Entry').closest('label');
      expect(manualLabel).toHaveClass('border-foreground');
    });

    it('calls onTipSourceChange when POS Import is clicked', () => {
      const onTipSourceChange = vi.fn();
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          onTipSourceChange={onTipSourceChange}
        />
      );

      fireEvent.click(screen.getByText('POS Import'));
      expect(onTipSourceChange).toHaveBeenCalledWith('pos');
    });
  });

  describe('Share Method Selection', () => {
    it('highlights selected share method', () => {
      render(<TipPoolSettingsDialog {...defaultProps} shareMethod="hours" />);
      const hoursLabel = screen.getByText('By Hours Worked').closest('label');
      expect(hoursLabel).toHaveClass('border-foreground');
    });

    it('calls onShareMethodChange when By Role is clicked', () => {
      const onShareMethodChange = vi.fn();
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          onShareMethodChange={onShareMethodChange}
        />
      );

      fireEvent.click(screen.getByText('By Role'));
      expect(onShareMethodChange).toHaveBeenCalledWith('role');
    });

    it('calls onShareMethodChange when Even Split is clicked', () => {
      const onShareMethodChange = vi.fn();
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          onShareMethodChange={onShareMethodChange}
        />
      );

      fireEvent.click(screen.getByText('Even Split'));
      expect(onShareMethodChange).toHaveBeenCalledWith('manual');
    });
  });

  describe('Role Weights - Critical for Fair Pay', () => {
    it('shows role weights when share method is role', () => {
      render(<TipPoolSettingsDialog {...defaultProps} shareMethod="role" />);
      expect(screen.getByText('Role Weights')).toBeInTheDocument();
    });

    it('hides role weights when share method is not role', () => {
      render(<TipPoolSettingsDialog {...defaultProps} shareMethod="hours" />);
      expect(screen.queryByText('Role Weights')).not.toBeInTheDocument();
    });

    it('shows role weights for each unique role', () => {
      render(<TipPoolSettingsDialog {...defaultProps} shareMethod="role" />);
      expect(screen.getByLabelText('Server')).toBeInTheDocument();
      expect(screen.getByLabelText('Bartender')).toBeInTheDocument();
      expect(screen.getByLabelText('Busser')).toBeInTheDocument();
    });

    it('displays current role weight values', () => {
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          shareMethod="role"
          roleWeights={{ Server: 1.5, Bartender: 1, Busser: 0.5 }}
        />
      );
      expect(screen.getByLabelText('Server')).toHaveValue(1.5);
      expect(screen.getByLabelText('Bartender')).toHaveValue(1);
      expect(screen.getByLabelText('Busser')).toHaveValue(0.5);
    });

    it('calls onRoleWeightsChange when weight is updated', () => {
      const onRoleWeightsChange = vi.fn();
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          shareMethod="role"
          onRoleWeightsChange={onRoleWeightsChange}
        />
      );

      const serverInput = screen.getByLabelText('Server');
      fireEvent.change(serverInput, { target: { value: '2' } });

      expect(onRoleWeightsChange).toHaveBeenCalledWith(
        expect.objectContaining({ Server: 2 })
      );
    });
  });

  describe('Employee Selection - Critical for Fair Pay', () => {
    it('shows all eligible employees with checkboxes', () => {
      render(<TipPoolSettingsDialog {...defaultProps} />);
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(3);
    });

    it('checks boxes for selected employees', () => {
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          selectedEmployees={new Set(['1', '2'])}
        />
      );
      expect(screen.getByText('2 of 3 employees selected')).toBeInTheDocument();
    });

    it('calls onSelectedEmployeesChange when Select All is clicked', () => {
      const onSelectedEmployeesChange = vi.fn();
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          selectedEmployees={new Set(['1'])}
          onSelectedEmployeesChange={onSelectedEmployeesChange}
        />
      );

      fireEvent.click(screen.getByText('Select All'));
      expect(onSelectedEmployeesChange).toHaveBeenCalledWith(
        new Set(['1', '2', '3'])
      );
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

    it('shows message when no eligible employees', () => {
      render(
        <TipPoolSettingsDialog {...defaultProps} eligibleEmployees={[]} />
      );
      expect(
        screen.getByText(/No eligible employees found/)
      ).toBeInTheDocument();
    });
  });

  describe('Split Cadence Selection', () => {
    it('highlights selected cadence', () => {
      render(<TipPoolSettingsDialog {...defaultProps} splitCadence="daily" />);
      const dailyLabel = screen.getByText('Daily').closest('label');
      expect(dailyLabel).toHaveClass('border-foreground');
    });

    it('calls onSplitCadenceChange when Weekly is clicked', () => {
      const onSplitCadenceChange = vi.fn();
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          onSplitCadenceChange={onSplitCadenceChange}
        />
      );

      fireEvent.click(screen.getByText('Weekly'));
      expect(onSplitCadenceChange).toHaveBeenCalledWith('weekly');
    });
  });

  describe('Dialog Actions', () => {
    it('calls onClose when Done is clicked', () => {
      const onClose = vi.fn();
      render(<TipPoolSettingsDialog {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('Done'));
      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when dialog is dismissed', () => {
      const onClose = vi.fn();
      render(<TipPoolSettingsDialog {...defaultProps} onClose={onClose} />);

      // Press escape or click outside
      const dialogContent = screen.getByRole('dialog');
      fireEvent.keyDown(dialogContent, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Configuration Scenarios - Real World', () => {
    it('Scenario: Restaurant using hours-based split with all staff', () => {
      const { container } = render(
        <TipPoolSettingsDialog
          {...defaultProps}
          tipSource="manual"
          shareMethod="hours"
          splitCadence="daily"
          selectedEmployees={new Set(['1', '2', '3'])}
        />
      );

      expect(screen.getByText('3 of 3 employees selected')).toBeInTheDocument();
      expect(screen.queryByText('Role Weights')).not.toBeInTheDocument();
    });

    it('Scenario: Fine dining using role-based split with weighted positions', () => {
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          tipSource="manual"
          shareMethod="role"
          roleWeights={{ Server: 1.0, Bartender: 1.0, Busser: 0.5 }}
        />
      );

      expect(screen.getByText('Role Weights')).toBeInTheDocument();
      expect(screen.getByLabelText('Server')).toHaveValue(1);
      expect(screen.getByLabelText('Busser')).toHaveValue(0.5);
    });

    it('Scenario: Small cafe using even split', () => {
      render(
        <TipPoolSettingsDialog
          {...defaultProps}
          shareMethod="manual"
          selectedEmployees={new Set(['1', '2'])}
        />
      );

      expect(screen.queryByText('Role Weights')).not.toBeInTheDocument();
      expect(screen.getByText('2 of 3 employees selected')).toBeInTheDocument();
    });
  });
});
