import { renderHook, act } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { useAutoSaveTipSettings } from '@/hooks/useAutoSaveTipSettings';
import type { TipPoolSettings, ShareMethod, TipSource, SplitCadence } from '@/hooks/useTipPoolSettings';

const baseSettings: TipPoolSettings = {
  id: 'settings-1',
  restaurant_id: 'rest-1',
  tip_source: 'manual',
  share_method: 'hours',
  split_cadence: 'daily',
  role_weights: { Server: 1 },
  enabled_employee_ids: [],
  active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

type HookProps = {
  settings: TipPoolSettings | null;
  tipSource: TipSource;
  shareMethod: ShareMethod;
  splitCadence: SplitCadence;
  roleWeights: Record<string, number>;
  selectedEmployees: Set<string>;
  onSave: () => void;
};

describe('useAutoSaveTipSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('debounces saving when settings change', async () => {
    const onSave = vi.fn();
    const initialProps: HookProps = {
      settings: baseSettings,
      tipSource: 'manual',
      shareMethod: 'hours',
      splitCadence: 'daily',
      roleWeights: baseSettings.role_weights,
      selectedEmployees: new Set(),
      onSave,
    };

    const { rerender } = renderHook(
      (props: HookProps) => useAutoSaveTipSettings(props),
      { initialProps }
    );

    rerender({ ...initialProps, shareMethod: 'role' });

    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not save when settings match existing values', async () => {
    const onSave = vi.fn();
    const props: HookProps = {
      settings: baseSettings,
      tipSource: 'manual',
      shareMethod: 'hours',
      splitCadence: 'daily',
      roleWeights: baseSettings.role_weights,
      selectedEmployees: new Set(),
      onSave,
    };

    renderHook((hookProps: HookProps) => useAutoSaveTipSettings(hookProps), {
      initialProps: props,
    });

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does nothing when settings are not loaded', async () => {
    const onSave = vi.fn();
    const props: HookProps = {
      settings: null,
      tipSource: 'manual',
      shareMethod: 'hours',
      splitCadence: 'daily',
      roleWeights: baseSettings.role_weights,
      selectedEmployees: new Set(),
      onSave,
    };

    renderHook((hookProps: HookProps) => useAutoSaveTipSettings(hookProps), {
      initialProps: props,
    });

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});
