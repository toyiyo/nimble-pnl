import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SkipToContent, MAIN_CONTENT_ID } from '@/components/SkipToContent';

describe('SkipToContent', () => {
  it('moves focus to the main content and does not change the URL hash', () => {
    window.location.hash = '#/';
    render(
      <>
        <SkipToContent />
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>Content</main>
      </>
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(document.activeElement).toBe(document.getElementById(MAIN_CONTENT_ID));
    expect(window.location.hash).toBe('#/');
  });

  it('is visually hidden until it gets keyboard focus', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
  });
});
