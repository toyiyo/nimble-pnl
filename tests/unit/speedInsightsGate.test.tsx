import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import { SpeedInsightsGate } from '@/components/SpeedInsightsGate';

// Mock the platform check so each test picks web or native.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn() },
}));

// Mock the Vercel component. The real one injects a script tag; the test
// only checks that the gate renders it or skips it.
vi.mock('@vercel/speed-insights/react', () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

describe('SpeedInsightsGate', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReset();
  });

  it('renders Speed Insights on the web', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    render(<SpeedInsightsGate />);
    expect(screen.queryByTestId('speed-insights')).not.toBeNull();
  });

  it('renders nothing on native', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    render(<SpeedInsightsGate />);
    expect(screen.queryByTestId('speed-insights')).toBeNull();
  });
});
