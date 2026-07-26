/**
 * Unit tests for `resolveSettingsOverrides` — the pure helper that turns the
 * on-chart SPLH slider's local preview state into the `settingsOverrides`
 * argument `useWeekStaffingSuggestions` expects (design doc §B/§E, plan 5.1).
 *
 * `sliderTarget === null` means "no live preview — use the saved settings",
 * which must produce `null` (the hook's existing no-override sentinel) rather
 * than an object with an `undefined` `target_splh`, since the hook filters
 * `undefined` overrides but a bare `null` skips that merge entirely.
 */
import { describe, it, expect } from 'vitest';
import { resolveSettingsOverrides } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';

describe('resolveSettingsOverrides', () => {
  it('returns null when sliderTarget is null (no live preview — use saved settings)', () => {
    expect(resolveSettingsOverrides(null)).toBeNull();
  });

  it('returns { target_splh: sliderTarget } when sliderTarget is a preview value', () => {
    expect(resolveSettingsOverrides(60)).toEqual({ target_splh: 60 });
  });

  it('treats 0 as a real preview value, not "unset" (0 !== null)', () => {
    expect(resolveSettingsOverrides(0)).toEqual({ target_splh: 0 });
  });
});
