import { describe, it, expect, vi } from 'vitest';
import { applyPreferences } from '../../supabase/functions/_shared/schedule-preference-llm';

describe('applyPreferences — no preferences', () => {
  it('empty text → no fetch, shifts returned untouched', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called when prefs are empty');
    });

    const shifts = [
      { employee_id: 'e1', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = await applyPreferences(shifts, { employees: [], templates: [] } as any, '', []);
    expect(result.shifts).toEqual(shifts);
    expect(result.appliedSwaps).toEqual([]);
    expect(result.rejectedSwaps).toEqual([]);
    expect(result.modelUsed).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
