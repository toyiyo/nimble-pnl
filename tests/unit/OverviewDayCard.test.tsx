import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OverviewDayCard } from '@/components/scheduling/ShiftPlanner/OverviewDayCard';

const baseDay = {
  day: '2026-04-20',
  pills: [],
  collapsedCount: 0,
  hasGap: false,
  gapLabel: null,
  unstaffed: true,
};

describe('<OverviewDayCard>', () => {
  it('renders an "unstaffed" chip when there are no shifts', () => {
    render(<OverviewDayCard data={baseDay} />);
    expect(screen.getByText(/unstaffed/i)).toBeInTheDocument();
  });

  it('renders one pill per shift up to 3 lanes', () => {
    const data = {
      ...baseDay,
      unstaffed: false,
      pills: [
        { shiftId: '1', employeeId: 'e1', employeeName: 'Alice', position: 'server', startHour: 9, endHour: 13, lane: 0 },
        { shiftId: '2', employeeId: 'e2', employeeName: 'Bob', position: 'cook', startHour: 10, endHour: 16, lane: 1 },
        { shiftId: '3', employeeId: 'e3', employeeName: 'Cal', position: 'dish', startHour: 14, endHour: 18, lane: 0 },
      ],
    };
    const { container } = render(<OverviewDayCard data={data} />);
    const pills = container.querySelectorAll('[data-shift-pill]');
    expect(pills).toHaveLength(3);
  });

  it('renders "+N more" chip when shifts were collapsed', () => {
    const data = {
      ...baseDay,
      unstaffed: false,
      collapsedCount: 2,
      pills: [
        { shiftId: '1', employeeId: 'e1', employeeName: 'Alice', position: 'server', startHour: 9, endHour: 13, lane: 0 },
      ],
    };
    render(<OverviewDayCard data={data} />);
    expect(screen.getByText(/\+2 more/i)).toBeInTheDocument();
  });

  it('renders gap chip when hasGap is true', () => {
    const data = {
      ...baseDay,
      unstaffed: false,
      pills: [
        { shiftId: '1', employeeId: 'e1', employeeName: 'Alice', position: 'server', startHour: 9, endHour: 11, lane: 0 },
      ],
      hasGap: true,
      gapLabel: 'Gap 3p',
    };
    render(<OverviewDayCard data={data} />);
    expect(screen.getByText(/gap 3p/i)).toBeInTheDocument();
  });
});
