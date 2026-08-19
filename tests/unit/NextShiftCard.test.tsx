import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextShiftCard } from '@/components/employee/NextShiftCard';
import type { Shift } from '@/types/scheduling';

const shift = {
  id: 'a',
  start_time: '2026-08-20T13:00:00Z',
  end_time: '2026-08-20T21:00:00Z',
  status: 'scheduled',
} as Shift;

const base = { isLoading: false, isError: false, timezone: 'America/New_York' };

describe('NextShiftCard', () => {
  it('shows a skeleton while it loads', () => {
    render(<NextShiftCard {...base} shifts={[]} isLoading />);
    expect(screen.getByTestId('next-shift-loading')).toBeInTheDocument();
  });

  it('states an error, and does not claim that no shift exists', () => {
    render(<NextShiftCard {...base} shifts={[]} isError />);
    expect(screen.getByText("We couldn't load your next shift.")).toBeInTheDocument();
    expect(screen.queryByText(/No shift scheduled/)).toBeNull();
  });

  it('states the empty case', () => {
    render(<NextShiftCard {...base} shifts={[]} />);
    expect(screen.getByText('No shift scheduled in the next 3 weeks.')).toBeInTheDocument();
  });

  it('states the next shift', () => {
    render(<NextShiftCard {...base} shifts={[shift]} />);
    expect(screen.getByText('You work next')).toBeInTheDocument();
    expect(screen.getAllByText(/9:00 AM/).length).toBeGreaterThan(0);
  });

  it('lists the shifts that follow', () => {
    const second = { ...shift, id: 'b', start_time: '2026-08-22T13:00:00Z', end_time: '2026-08-22T21:00:00Z' } as Shift;
    render(<NextShiftCard {...base} shifts={[shift, second]} />);
    expect(screen.getByTestId('next-shift-following').children).toHaveLength(1);
  });
});
