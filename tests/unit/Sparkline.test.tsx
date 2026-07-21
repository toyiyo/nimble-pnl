import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Sparkline } from '@/components/labor/Sparkline';

describe('Sparkline', () => {
  it('renders a polyline path for ≥2 numeric values', () => {
    const { container } = render(<Sparkline values={[1, 5, 3, 8]} />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toMatch(/^M/);
    expect(path?.getAttribute('d')).toContain('L');
  });

  it('renders nothing when there are fewer than 2 finite values', () => {
    const { container } = render(<Sparkline values={[null, 4, null]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('breaks the path at null gaps (no interpolated segment across a gap)', () => {
    // Two segments (before/after the null) → two move (M) commands.
    const { container } = render(<Sparkline values={[1, 2, null, 4, 5]} />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it('applies the tone className so currentColor picks up the caller tone', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} className="text-[hsl(var(--labor-over))]" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('text-[hsl(var(--labor-over))]');
  });
});
