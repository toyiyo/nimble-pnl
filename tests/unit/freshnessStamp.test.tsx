import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FreshnessStamp } from '@/components/banking/FreshnessStamp';

describe('FreshnessStamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "Not yet verified" and no date when dataCurrentThrough is null', () => {
    render(<FreshnessStamp dataCurrentThrough={null} />);

    expect(screen.getByText('Not yet verified')).toBeInTheDocument();
    expect(screen.queryByText(/Data through/)).not.toBeInTheDocument();
  });

  it('applies the muted token (not amber) to the NULL state', () => {
    render(<FreshnessStamp dataCurrentThrough={null} />);

    const el = screen.getByText('Not yet verified');
    expect(el.className).toContain('text-muted-foreground');
    expect(el.className).not.toMatch(/amber/);
  });

  it('renders "Data through <date>" muted when fresh (< 3 days behind)', () => {
    // "now" is 2026-07-23T12:00:00Z; data is through 2026-07-21 (2 whole UTC days behind).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'));

    render(<FreshnessStamp dataCurrentThrough="2026-07-21T09:00:00.000Z" />);

    expect(screen.getByText(/Data through/)).toBeInTheDocument();
    expect(screen.getByText('Jul 21')).toBeInTheDocument();
    expect(screen.queryByText(/days behind/)).not.toBeInTheDocument();

    const container = screen.getByText(/Data through/);
    expect(container.className).toContain('text-muted-foreground');
    expect(container.className).not.toMatch(/amber/);
  });

  it('renders the "· N days behind" suffix in amber when stale (>= 3 days behind)', () => {
    // "now" is 2026-07-23T12:00:00Z; data is through 2026-07-12 (11 whole UTC days behind).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'));

    render(<FreshnessStamp dataCurrentThrough="2026-07-12T09:00:00.000Z" />);

    expect(screen.getByText('Jul 12')).toBeInTheDocument();
    expect(screen.getByText(/11 days behind/)).toBeInTheDocument();

    const container = screen.getByText(/Data through/);
    expect(container.className).toMatch(/amber/);
  });

  it('treats exactly 3 days as stale (boundary is inclusive)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'));

    render(<FreshnessStamp dataCurrentThrough="2026-07-20T23:59:59.000Z" />);

    expect(screen.getByText(/3 days behind/)).toBeInTheDocument();
  });

  it('treats exactly 2 days as fresh (boundary is exclusive)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'));

    render(<FreshnessStamp dataCurrentThrough="2026-07-21T00:00:00.000Z" />);

    expect(screen.queryByText(/days behind/)).not.toBeInTheDocument();
  });

  it('floors the gap to whole UTC calendar days: same UTC day, different clock times, same N', () => {
    // data_current_through is a timestamptz late in its UTC day; "now" moves forward
    // several hours but stays within the same UTC calendar day. The rendered N must
    // not change just because the clock advanced within that day.
    const dataCurrentThrough = '2026-07-10T23:30:00.000Z';

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:05:00.000Z'));
    const { unmount } = render(<FreshnessStamp dataCurrentThrough={dataCurrentThrough} />);
    expect(screen.getByText(/13 days behind/)).toBeInTheDocument();
    unmount();

    vi.setSystemTime(new Date('2026-07-23T23:55:00.000Z'));
    render(<FreshnessStamp dataCurrentThrough={dataCurrentThrough} />);
    expect(screen.getByText(/13 days behind/)).toBeInTheDocument();
  });

  it('uses tabular-nums on the date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'));

    render(<FreshnessStamp dataCurrentThrough="2026-07-21T09:00:00.000Z" />);

    const dateEl = screen.getByText('Jul 21');
    expect(dateEl.className).toContain('tabular-nums');
  });

  it('carries the full instant in the title attribute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'));

    const iso = '2026-07-21T09:00:00.000Z';
    render(<FreshnessStamp dataCurrentThrough={iso} />);

    const container = screen.getByText(/Data through/);
    expect(container).toHaveAttribute('title', iso);
  });
});
