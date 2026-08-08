import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ReviewTentSheet } from '@/components/reviews/ReviewTentSheet';

const BASE = {
  size: 'tent' as const,
  restaurantName: 'Blue Fin Sushi',
  logoUrl: null,
  message: 'How was everything?',
  qrSvg: '<svg role="presentation"><rect /></svg>',
  publicUrl: 'https://app.test/r/blue-fin',
};

describe('ReviewTentSheet', () => {
  it('shows the restaurant name, the message, and the URL', () => {
    render(<ReviewTentSheet {...BASE} />);
    expect(screen.getByText('Blue Fin Sushi')).toBeInTheDocument();
    expect(screen.getByText('How was everything?')).toBeInTheDocument();
    expect(screen.getByText('app.test/r/blue-fin')).toBeInTheDocument();
  });

  it('shows the initials circle when there is no logo', () => {
    const { container } = render(<ReviewTentSheet {...BASE} />);
    expect(screen.getByText('BF')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the logo when there is one', () => {
    const { container } = render(
      <ReviewTentSheet {...BASE} logoUrl="https://cdn.test/logo.png" />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://cdn.test/logo.png');
    expect(img).toHaveAttribute('alt', '');
    // No `crossOrigin`. Nothing draws this logo to a canvas, so the attribute
    // buys nothing and adds a CORS rule that can fail a logo the guest page
    // loads. The sheet must load the logo the same way the guest page does.
    expect(img).not.toHaveAttribute('crossorigin');
  });

  it('falls back to the initials when the logo fails to load', () => {
    const { container } = render(
      <ReviewTentSheet {...BASE} logoUrl="https://cdn.test/broken.png" />
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('BF')).toBeInTheDocument();
  });

  it('turns every sticker tile to the initials when one logo fails', () => {
    // Six tiles, one URL, one flag. Six local flags would let a slow request
    // print five logos and one circle on the same physical sheet.
    const { container } = render(
      <ReviewTentSheet {...BASE} size="stickers" logoUrl="https://cdn.test/broken.png" />
    );
    expect(container.querySelectorAll('img')).toHaveLength(6);

    fireEvent.error(container.querySelectorAll('img')[0]);

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getAllByText('BF')).toHaveLength(6);
  });

  it('renders one tile for the tent and six for the sticker sheet', () => {
    const { container: tent } = render(<ReviewTentSheet {...BASE} />);
    expect(tent.querySelectorAll('.print-tile')).toHaveLength(1);

    const { container: stickers } = render(<ReviewTentSheet {...BASE} size="stickers" />);
    expect(stickers.querySelectorAll('.print-tile')).toHaveLength(6);
  });

  it('carries the theme, the size, and aria-hidden on its root', () => {
    const { container } = render(<ReviewTentSheet {...BASE} size="card" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-size', 'card');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.className).toContain('theme-counter');
  });

  it('sizes the paper from SHEET_SIZES, not from a hand-written value', () => {
    const { container } = render(<ReviewTentSheet {...BASE} size="card" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('5.5in');
    expect(root.style.height).toBe('8.5in');
  });

  it('renders no QR block until the SVG arrives', () => {
    const { container } = render(<ReviewTentSheet {...BASE} qrSvg={null} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
