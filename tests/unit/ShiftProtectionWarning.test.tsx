/**
 * Unit tests: the shared Shift Protection warning panel.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ShiftProtectionWarning } from '@/components/scheduling/ShiftProtectionWarning';

describe('ShiftProtectionWarning', () => {
  it('renders the id, the title, every message, and the footnote', () => {
    render(
      <ShiftProtectionWarning
        id="panel-1"
        title="Shift protection findings"
        messages={['First finding.', 'Second finding.']}
        footnote="You can still submit."
      />
    );

    const panel = screen.getByRole('status');
    expect(panel).toHaveAttribute('id', 'panel-1');
    expect(screen.getByText('Shift protection findings')).toBeInTheDocument();
    expect(screen.getByText('First finding.')).toBeInTheDocument();
    expect(screen.getByText('Second finding.')).toBeInTheDocument();
    expect(screen.getByText('You can still submit.')).toBeInTheDocument();
  });

  it('renders without the optional parts', () => {
    render(<ShiftProtectionWarning messages={['Only finding.']} />);
    const panel = screen.getByRole('status');
    expect(panel).not.toHaveAttribute('id');
    expect(screen.getByText('Only finding.')).toBeInTheDocument();
  });
});
