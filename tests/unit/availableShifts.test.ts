import { describe, it, expect } from 'vitest';
import { mergeAvailableShifts } from '@/hooks/useAvailableShifts';
import type { OpenShift } from '@/types/scheduling';

const TZ = 'America/Los_Angeles'; // UTC-7 in October 2026

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
    expect(mergeAvailableShifts([], [], TZ)).toEqual([]);
  });

  it('includes open shifts with type "open_shift"', () => {
    const result = mergeAvailableShifts([makeOpenShift()], [], TZ);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('open_shift');
    expect(result[0].openShift?.template_name).toBe('Closing Server');
  });

  it('includes trades with type "trade"', () => {
    const result = mergeAvailableShifts([], [makeTrade()], TZ);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('trade');
  });

  it('sorts by date ascending', () => {
    const result = mergeAvailableShifts(
      [makeOpenShift({ shift_date: '2026-04-20' })],
      [makeTrade({ offered_shift: { id: 's1', start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', position: 'Server', break_duration: 0 } })],
      TZ,
    );
    expect(result[0].type).toBe('trade');
    expect(result[1].type).toBe('open_shift');
  });

  it('generates unique keys', () => {
    const result = mergeAvailableShifts(
      [makeOpenShift(), makeOpenShift({ template_id: 'tpl-2', template_name: 'Opener' })],
      [makeTrade()],
      TZ,
    );
    const keys = result.map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sorts two same-UTC-day trades into time order regardless of input order', () => {
    const earlier = makeTrade({
      id: 'trade-early',
      offered_shift: { id: 's-early', start_time: '2026-10-02T15:00:00Z', end_time: '2026-10-02T20:00:00Z', position: 'Server', break_duration: 0 },
    });
    const later = makeTrade({
      id: 'trade-late',
      offered_shift: { id: 's-late', start_time: '2026-10-02T18:00:00Z', end_time: '2026-10-02T23:00:00Z', position: 'Server', break_duration: 0 },
    });
    const result = mergeAvailableShifts([], [later, earlier], TZ);
    expect(result.map(r => r.trade?.id)).toEqual(['trade-early', 'trade-late']);
  });

  it('orders a trade before an open shift on the next UTC day when the local time is earlier', () => {
    const trade = makeTrade({
      id: 'trade-cross-midnight',
      offered_shift: { id: 's1', start_time: '2026-10-03T01:00:00Z', end_time: '2026-10-03T06:00:00Z', position: 'Server', break_duration: 0 },
    });
    const openShift = makeOpenShift({ shift_date: '2026-10-02', start_time: '20:00:00' });
    const result = mergeAvailableShifts([openShift], [trade], TZ);
    expect(result[0].type).toBe('trade');
    expect(result[1].type).toBe('open_shift');
  });

  it('gives a trade the local date, not the UTC date', () => {
    const trade = makeTrade({
      offered_shift: { id: 's1', start_time: '2026-10-02T06:30:00Z', end_time: '2026-10-02T11:30:00Z', position: 'Server', break_duration: 0 },
    });
    const result = mergeAvailableShifts([], [trade], TZ);
    expect(result[0].date).toBe('2026-10-01');
  });

  it('sets startsAt on an open shift from its local date and start time', () => {
    const openShift = makeOpenShift({ shift_date: '2026-10-02', start_time: '09:00:00' });
    const result = mergeAvailableShifts([openShift], [], TZ);
    expect(result[0].startsAt).toBe(Date.parse('2026-10-02T16:00:00Z'));
  });

  it('puts a trade with no offered_shift first, with an empty date', () => {
    const trade = makeTrade({ offered_shift: null });
    const openShift = makeOpenShift({ shift_date: '2026-10-02' });
    const result = mergeAvailableShifts([openShift], [trade], TZ);
    expect(result[0].type).toBe('trade');
    expect(result[0].date).toBe('');
  });

  it('keeps input order for two trades that both have no offered_shift', () => {
    const first = makeTrade({ id: 'trade-a', offered_shift: null });
    const second = makeTrade({ id: 'trade-b', offered_shift: null });
    const result = mergeAvailableShifts([], [first, second], TZ);
    expect(result.map(r => r.trade?.id)).toEqual(['trade-a', 'trade-b']);
  });
});
