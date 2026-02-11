import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoSaveTipSettings } from '@/hooks/useAutoSaveTipSettings';
import type { TipPoolSettings } from '@/hooks/useTipPoolSettings';

describe('useAutoSaveTipSettings', () => {
  let onSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onSave = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultSettings: TipPoolSettings = {
    id: 'test-id',
    restaurant_id: 'restaurant-1',
    tip_source: 'manual',
    share_method: 'hours',
    split_cadence: 'daily',
    role_weights: { Server: 1, Bartender: 1 },
    enabled_employee_ids: ['emp1', 'emp2'],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };

  it('does not trigger save when settings is null and all values are defaults', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: null,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {},
        selectedEmployees: new Set(),
        onSave,
      })
    );

    vi.advanceTimersByTime(1500);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('triggers save when settings is null but user has configured values', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: null,
        tipSource: 'pos',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {},
        selectedEmployees: new Set(),
        onSave,
      })
    );

    vi.advanceTimersByTime(1500);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not trigger save when no changes detected', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1500);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('triggers save after 1 second when tipSource changes', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'pos', // Changed from 'manual'
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    // Should not call immediately
    expect(onSave).not.toHaveBeenCalled();

    // Should not call before timeout
    vi.advanceTimersByTime(500);
    expect(onSave).not.toHaveBeenCalled();

    // Should call after 1 second
    vi.advanceTimersByTime(500);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when shareMethod changes', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'even', // Changed from 'hours'
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when splitCadence changes', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'weekly', // Changed from 'daily'
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when roleWeights changes', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 2, Bartender: 1 }, // Changed Server weight
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when new role added to roleWeights', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1, Runner: 1 }, // Added Runner
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when selectedEmployees changes', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1', 'emp2', 'emp3']), // Added emp3
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when employee removed from selectedEmployees', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1']), // Removed emp2
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('handles selectedEmployees order independence', () => {
    // Employee IDs in different order should not trigger save
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp2', 'emp1']), // Different order, same IDs
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    // Should not trigger because they're sorted before comparison
    expect(onSave).not.toHaveBeenCalled();
  });

  it('handles settings with null enabled_employee_ids', () => {
    const settingsWithNullEmployees = {
      ...defaultSettings,
      enabled_employee_ids: null,
    };

    renderHook(() =>
      useAutoSaveTipSettings({
        settings: settingsWithNullEmployees,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    // Should trigger because null is treated as [] and Set has items
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('debounces multiple rapid changes', () => {
    const { rerender } = renderHook(
      (props) => useAutoSaveTipSettings(props),
      {
        initialProps: {
          settings: defaultSettings,
          tipSource: 'manual' as const,
          shareMethod: 'hours' as const,
          splitCadence: 'daily' as const,
          roleWeights: { Server: 1, Bartender: 1 },
          selectedEmployees: new Set(['emp1', 'emp2']),
          onSave,
        },
      }
    );

    // First change
    rerender({
      settings: defaultSettings,
      tipSource: 'pos',
      shareMethod: 'hours',
      splitCadence: 'daily',
      roleWeights: { Server: 1, Bartender: 1 },
      selectedEmployees: new Set(['emp1', 'emp2']),
      onSave,
    });

    vi.advanceTimersByTime(500);

    // Second change before timeout
    rerender({
      settings: defaultSettings,
      tipSource: 'pos',
      shareMethod: 'even',
      splitCadence: 'daily',
      roleWeights: { Server: 1, Bartender: 1 },
      selectedEmployees: new Set(['emp1', 'emp2']),
      onSave,
    });

    vi.advanceTimersByTime(500);

    // Should not have called yet (only 500ms since last change)
    expect(onSave).not.toHaveBeenCalled();

    // Complete the timeout
    vi.advanceTimersByTime(500);

    // Should only call once after all changes
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('clears timeout on unmount', () => {
    const { unmount } = renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'pos',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(500);
    unmount();
    vi.advanceTimersByTime(500);

    // Should not call after unmount
    expect(onSave).not.toHaveBeenCalled();
  });

  it('handles empty roleWeights', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {}, // Empty object
        selectedEmployees: new Set(['emp1', 'emp2']),
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('handles empty selectedEmployees set', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: { Server: 1, Bartender: 1 },
        selectedEmployees: new Set(), // Empty set
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('triggers save when multiple fields change simultaneously', () => {
    renderHook(() =>
      useAutoSaveTipSettings({
        settings: defaultSettings,
        tipSource: 'pos', // Changed
        shareMethod: 'even', // Changed
        splitCadence: 'weekly', // Changed
        roleWeights: { Server: 2 }, // Changed
        selectedEmployees: new Set(['emp1']), // Changed
        onSave,
      })
    );

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
