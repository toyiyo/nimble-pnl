import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageGapList } from '@/components/scheduling/ShiftTimeline/CoverageGapList';

describe('CoverageGapList', () => {
  it('lists each understaffed window as text', () => {
    // gap: startMin=600, endMin=615 (last under-staffed 15-min sample)
    // displayed end = endMin + STEP_MIN = 630 → "10:30a"
    render(<CoverageGapList gaps={[{ startMin: 600, endMin: 615 }]} />);
    // minutesToCompact(600) → "10a"
    expect(screen.getByText(/10a/i)).toBeInTheDocument();
    // minutesToCompact(630) → "10:30a"
    expect(screen.getByText(/10:30a/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /understaffed/i })).toBeInTheDocument();
  });
  it('renders nothing when there are no gaps', () => {
    const { container } = render(<CoverageGapList gaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
