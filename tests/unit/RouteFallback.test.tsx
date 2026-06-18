import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteFallback } from '@/components/RouteFallback';

describe('RouteFallback', () => {
  it('renders a status live region', () => {
    render(<RouteFallback />);
    const status = screen.getByRole('status');
    expect(status).toBeDefined();
  });

  it('has a non-empty accessible text so the live region is meaningful', () => {
    render(<RouteFallback />);
    const status = screen.getByRole('status');
    // The element must contain visible or sr-only text — not be empty
    expect(status.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders a decorative spinner SVG that carries aria-hidden="true"', () => {
    render(<RouteFallback />);
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0); // non-vacuous: a spinner must actually render
    svgs.forEach((svg) => {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
