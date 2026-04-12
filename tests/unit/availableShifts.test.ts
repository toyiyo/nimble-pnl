import { describe, it, expect } from 'vitest';
import { mergeAvailableShifts } from '@/hooks/useAvailableShifts';
import type { OpenShift } from '@/types/scheduling';

const makeOpenShift = (overrides: Partial<OpenShift> = {}): OpenShift => ({
  template_id: 'tpl-1',
  template_name: 'Closing Server',
  shift_date: '2026-04-18',
  start_time: '16:00:00',
  end_time: '22:00:00',
  position: 'Server',
  area: null,
  capacity: 3,
  assigned_count: 1,
  pending_claims: 0,
  open_spots: 2,
  ...overrides,
});

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
  id: 'trade-1',
  status: 'open' as const,
  offered_shift: { id: 's1', start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', position: 'Server', break_duration: 0 },
  offered_by: { id: 'emp-1', name: 'Maria', email: null, position: 'Server' },
  ...overrides,
});

describe('mergeAvailableShifts', () => {
  it('returns empty array when no shifts or trades', () => {
    expect(mergeAvailableShifts([], [])).toEqual([]);
  });

  it('includes open shifts with type "open_shift"', () => {
    const result = mergeAvailableShifts([makeOpenShift()], []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('open_shift');
    expect(result[0].openShift?.template_name).toBe('Closing Server');
  });

  it('includes trades with type "trade"', () => {
    const result = mergeAvailableShifts([], [makeTrade()]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('trade');
  });

  it('sorts by date ascending', () => {
    const result = mergeAvailableShifts(
      [makeOpenShift({ shift_date: '2026-04-20' })],
      [makeTrade({ offered_shift: { id: 's1', start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', position: 'Server', break_duration: 0 } })],
    );
    expect(result[0].type).toBe('trade');
    expect(result[1].type).toBe('open_shift');
  });

  it('generates unique keys', () => {
    const result = mergeAvailableShifts(
      [makeOpenShift(), makeOpenShift({ template_id: 'tpl-2', template_name: 'Opener' })],
      [makeTrade()],
    );
    const keys = result.map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
