import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TentativeDraftBadge } from '@/components/schedule/TentativeDraftBadge';

describe('TentativeDraftBadge', () => {
  it('shows the exact tentative text', () => {
    render(<TentativeDraftBadge />);

    // The text is the accessible signal. The icon and the amber tokens are
    // supplementary, so a screen reader and a greyscale phone get the
    // same message.
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });
});
