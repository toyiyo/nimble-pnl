// tests/unit/helpVideoCard.test.ts
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpVideoCard } from '@/components/employee/HelpVideoCard';

const defaultProps = {
  videoKey: 'test-video',
  videoUrl: 'https://example.com/video.mp4',
  title: 'How to Clock In',
  description: 'Learn how to clock in for your shift',
  duration: '1:30',
};

describe('HelpVideoCard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders expanded when video has not been seen', () => {
    render(React.createElement(HelpVideoCard, defaultProps));

    expect(screen.getByText('How to Clock In')).toBeDefined();
    expect(screen.getByText('Learn how to clock in for your shift')).toBeDefined();

    const video = screen.getByTestId('help-video-player') as HTMLVideoElement;
    expect(video).toBeDefined();
    expect(video.src).toContain('https://example.com/video.mp4');
  });

  it('renders collapsed when video has been seen', () => {
    localStorage.setItem('help_video_seen_test-video', 'seen');

    render(React.createElement(HelpVideoCard, defaultProps));

    expect(screen.getByText('How to Clock In')).toBeDefined();
    expect(screen.queryByTestId('help-video-player')).toBeNull();
  });

  it('marks video as seen when dismissed', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(React.createElement(HelpVideoCard, defaultProps));

    const dismissButton = screen.getByRole('button', { name: 'Dismiss help video' });
    fireEvent.click(dismissButton);

    expect(setItemSpy).toHaveBeenCalledWith('help_video_seen_test-video', 'seen');
    expect(screen.queryByTestId('help-video-player')).toBeNull();
  });

  it('expands collapsed card when clicked', () => {
    localStorage.setItem('help_video_seen_test-video', 'seen');

    render(React.createElement(HelpVideoCard, defaultProps));

    expect(screen.queryByTestId('help-video-player')).toBeNull();

    const pill = screen.getByRole('button', { name: /How to Clock In/i });
    fireEvent.click(pill);

    expect(screen.getByTestId('help-video-player')).toBeDefined();
  });

  it('renders nothing when videoUrl is empty', () => {
    const { container } = render(
      React.createElement(HelpVideoCard, { ...defaultProps, videoUrl: '' })
    );

    expect(container.firstChild).toBeNull();
  });
});
