import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PinRevealDialog } from '@/components/time-clock/PinRevealDialog';

const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

const sample = [
  { employeeId: 'e1', name: 'Alice Ng',    position: 'Server', pin: '4729' },
  { employeeId: 'e2', name: 'Bob Smith',   position: 'Cook',   pin: '8163' },
];

describe('PinRevealDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one row per revealed PIN', () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    expect(screen.getByText('Alice Ng')).toBeInTheDocument();
    expect(screen.getByText('4729')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('8163')).toBeInTheDocument();
  });

  it('renders the non-recoverable warning', () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    expect(
      screen.getByText(/won't see these PINs again/i)
    ).toBeInTheDocument();
  });

  it('copy-all writes a newline-delimited string of `Name — PIN`', async () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));
    expect(writeTextMock).toHaveBeenCalledWith('Alice Ng — 4729\nBob Smith — 8163');
  });

  it('per-row copy writes only that PIN', async () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy pin for alice ng/i }));
    expect(writeTextMock).toHaveBeenCalledWith('4729');
  });

  it('Done button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(<PinRevealDialog open pins={sample} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
