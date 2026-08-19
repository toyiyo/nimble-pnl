import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftRow } from '@/components/employee/ShiftRow';
import type { Shift } from '@/types/scheduling';

const draft = {
  id: 'a',
  start_time: '2026-08-20T12:00:00Z',
  end_time: '2026-08-20T20:00:00Z',
  status: 'scheduled',
  is_published: false,
  break_minutes: 0,
} as Shift;

describe('ShiftRow draft treatment', () => {
  it('marks a draft when the restaurant publishes', () => {
    const { container } = render(<ShiftRow shift={draft} restaurantPublishes />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(container.querySelector('.border-dashed')).not.toBeNull();
  });

  it('shows a solid row when the restaurant does not publish', () => {
    const { container } = render(<ShiftRow shift={draft} restaurantPublishes={false} />);
    expect(screen.queryByText('Draft')).toBeNull();
    expect(container.querySelector('.border-dashed')).toBeNull();
  });

  it('marks a draft by default, so current call sites do not change', () => {
    render(<ShiftRow shift={draft} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
