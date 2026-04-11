import { describe, it, expect } from 'vitest';
import { HELP_VIDEOS } from '@/components/employee/helpVideoConfig';

describe('helpVideoConfig', () => {
  it('defines a config for each employee page', () => {
    const expectedKeys = [
      'welcome', 'clock', 'schedule', 'pay',
      'timecard', 'tips', 'shifts', 'requests',
    ];
    expectedKeys.forEach((key) => {
      expect(HELP_VIDEOS[key]).toBeDefined();
      expect(HELP_VIDEOS[key].videoKey).toContain('help_video_');
      expect(HELP_VIDEOS[key].title).toBeTruthy();
      expect(HELP_VIDEOS[key].description).toBeTruthy();
      expect(HELP_VIDEOS[key].videoUrl).toBeTruthy();
    });
  });

  it('has unique videoKeys for each entry', () => {
    const keys = Object.values(HELP_VIDEOS).map((v) => v.videoKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
