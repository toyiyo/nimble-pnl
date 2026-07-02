import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageGapList } from '@/components/scheduling/ShiftTimeline/CoverageGapList';

describe('CoverageGapList', () => {
  it('lists each understaffed window as text', () => {
    render(<CoverageGapList gaps={[{ startMin: 600, endMin: 690 }]} />);
    // minutesToCompact(600) → "10a"
    expect(screen.getByText(/10a/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /understaffed/i })).toBeInTheDocument();
  });
  it('renders nothing when there are no gaps', () => {
    const { container } = render(<CoverageGapList gaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
