import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppLogo } from '@/components/AppLogo';

describe('AppLogo', () => {
  it('renders an img with the logo src', () => {
    render(<AppLogo />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('/icon-192.png');
  });

  it('applies default size of 32px', () => {
    render(<AppLogo />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img.getAttribute('width')).toBe('32');
    expect(img.getAttribute('height')).toBe('32');
  });

  it('accepts custom size', () => {
    render(<AppLogo size={64} />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img.getAttribute('width')).toBe('64');
    expect(img.getAttribute('height')).toBe('64');
  });

  it('accepts custom className', () => {
    render(<AppLogo className="my-custom-class" />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img.className).toContain('my-custom-class');
  });
});
