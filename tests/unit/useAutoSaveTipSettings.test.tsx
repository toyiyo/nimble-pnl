import { renderHook, act } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { useAutoSaveTipSettings } from '@/hooks/useAutoSaveTipSettings';
import type { TipPoolSettings, ShareMethod, TipSource, SplitCadence } from '@/hooks/useTipPoolSettings';
import type { RoleAllocationRule } from '@/utils/tipPooling';

const baseSettings: TipPoolSettings = {
  id: 'settings-1',
  restaurant_id: 'rest-1',
  tip_source: 'manual',
  share_method: 'hours',
  split_cadence: 'daily',
  role_weights: { Server: 1 },
  role_percentages: {},
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
  rolePercentages: Record<string, RoleAllocationRule>;
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
      rolePercentages: baseSettings.role_percentages,
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
      rolePercentages: baseSettings.role_percentages,
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
      rolePercentages: baseSettings.role_percentages,
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

  it('saves when role percentages diverge from persisted settings', async () => {
    const onSave = vi.fn();
    const settings = {
      id: 's1',
      restaurant_id: 'r1',
      tip_source: 'manual',
      share_method: 'hours',
      split_cadence: 'daily',
      role_weights: {},
      role_percentages: {},
      enabled_employee_ids: [],
      pooling_model: 'full_pool',
      active: true,
      created_at: '',
      updated_at: '',
    } as never;

    renderHook(() =>
      useAutoSaveTipSettings({
        settings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {},
        rolePercentages: { Manager: { mode: 'at_least', percentage: 10 } },
        selectedEmployees: new Set<string>(),
        poolingModel: 'full_pool',
        onSave,
      }),
    );

    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not save when role percentages are unchanged', async () => {
    const onSave = vi.fn();
    const rules = { Manager: { mode: 'at_least' as const, percentage: 10 } };
    const settings = {
      id: 's1',
      restaurant_id: 'r1',
      tip_source: 'manual',
      share_method: 'hours',
      split_cadence: 'daily',
      role_weights: {},
      role_percentages: rules,
      enabled_employee_ids: [],
      pooling_model: 'full_pool',
      active: true,
      created_at: '',
      updated_at: '',
    } as never;

    renderHook(() =>
      useAutoSaveTipSettings({
        settings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {},
        rolePercentages: { Manager: { mode: 'at_least', percentage: 10 } },
        selectedEmployees: new Set<string>(),
        poolingModel: 'full_pool',
        onSave,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  // Postgres `jsonb` sorts keys rather than preserving insertion order, so a map
  // written as {Manager, Bartender} reads back as {Manager, Bartender} reordered
  // by length/bytes. A naive JSON.stringify comparison sees that as a change and
  // fires a save on every settings load.
  it('does not save when the persisted maps differ only in key order', async () => {
    const onSave = vi.fn();
    const settings = {
      ...baseSettings,
      role_weights: { Bartender: 2, Server: 1 },
      role_percentages: {
        Bartender: { percentage: 5, mode: 'exactly' },
        Manager: { percentage: 10, mode: 'at_least' },
      },
    } as never as TipPoolSettings;

    renderHook(() =>
      useAutoSaveTipSettings({
        settings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        // Same content, opposite key order at both levels.
        roleWeights: { Server: 1, Bartender: 2 },
        rolePercentages: {
          Manager: { mode: 'at_least', percentage: 10 },
          Bartender: { mode: 'exactly', percentage: 5 },
        },
        selectedEmployees: new Set<string>(),
        onSave,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
