import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPreferences, applySwapsToSchedule, type IdentifiedShift } from '../../supabase/functions/_shared/schedule-preference-llm';
import type { ScheduleContext } from '../../supabase/functions/_shared/schedule-solver';

describe('applyPreferences — no preferences', () => {
  it('empty text → no fetch, shifts returned untouched', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called when prefs are empty');
    });

    const shifts: IdentifiedShift[] = [
      { id: 'x1', employee_id: 'e1', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const minCtx = { employees: [], templates: [], availability: {}, excludedEmployeeIds: new Set(), lockedShifts: [], priorPatterns: [], weeklySalesHistory: [], hourlySalesHistory: [], requiredStaff: new Map(), restaurantId: '', weekStart: '', targetLaborPercentage: 0.3, minimumWageCents: 1500 } as ScheduleContext;
    const result = await applyPreferences(shifts, minCtx, '', []);
    expect(result.shifts).toEqual(shifts);
    expect(result.appliedSwaps).toEqual([]);
    expect(result.rejectedSwaps).toEqual([]);
    expect(result.modelUsed).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe('applySwapsToSchedule — pure re-validation', () => {
  const ctx: ScheduleContext = {
    restaurantId: 'r1', weekStart: '2026-06-08',
    requiredStaff: new Map(), lockedShifts: [], priorPatterns: [],
    weeklySalesHistory: [], hourlySalesHistory: [],
    targetLaborPercentage: 0.3, minimumWageCents: 1500,
    employees: [
      { id: 'eA', name: 'A', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '1990-01-01', is_minor: false },
      { id: 'eB', name: 'B', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '1990-01-01', is_minor: false },
    ],
    availability: {
      'eA': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
      'eB': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
    },
    excludedEmployeeIds: new Set(),
    templates: [
      { id: 't1', name: 'L', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1] },
    ],
  };

  it('legal swap is applied', () => {
    const shifts = [
      { id: 's1', employee_id: 'eA', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 's2', employee_id: 'eB', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = applySwapsToSchedule(shifts, ctx, [
      { shift_a_id: 's1', shift_b_id: 's2', reason: 'manager preference' },
    ]);
    expect(result.appliedSwaps).toHaveLength(1);
    expect(result.rejectedSwaps).toHaveLength(0);
    const newS1 = result.shifts.find((s) => s.id === 's1');
    const newS2 = result.shifts.find((s) => s.id === 's2');
    expect(newS1?.employee_id).toBe('eB');
    expect(newS2?.employee_id).toBe('eA');
  });

  it('unknown shift id → rejected', () => {
    const shifts = [
      { id: 's1', employee_id: 'eA', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = applySwapsToSchedule(shifts, ctx, [
      { shift_a_id: 's1', shift_b_id: 'nope', reason: 'x' },
    ]);
    expect(result.appliedSwaps).toHaveLength(0);
    expect(result.rejectedSwaps).toHaveLength(1);
    expect(result.rejectedSwaps[0].rejection_code).toBe('UNKNOWN_SHIFT');
  });

  it('swap that would move employee onto a template in a different area → rejected', () => {
    // Solver enforces area-isolation in eligibleBase. Without an equivalent
    // check in validateAffectedEmployees, the LLM can propose a swap that
    // crosses area boundaries and the validator approves it.
    const areaCtx: ScheduleContext = {
      ...ctx,
      employees: [
        { id: 'eK', name: 'K', position: 'Server', area: 'kitchen', max_weekly_hours: 40,
          date_of_birth: '1990-01-01', is_minor: false },
        { id: 'eB', name: 'B', position: 'Server', area: 'bar', max_weekly_hours: 40,
          date_of_birth: '1990-01-01', is_minor: false },
      ],
      availability: {
        'eK': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
        'eB': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
      },
      templates: [
        { id: 'tK', name: 'Kitchen Lunch', position: 'Server', area: 'kitchen',
          start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1] },
        { id: 'tB', name: 'Bar Lunch', position: 'Server', area: 'bar',
          start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1] },
      ],
    };
    const shifts = [
      { id: 'sK', employee_id: 'eK', template_id: 'tK', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 'sB', employee_id: 'eB', template_id: 'tB', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = applySwapsToSchedule(shifts, areaCtx, [
      { shift_a_id: 'sK', shift_b_id: 'sB', reason: 'swap K and B' },
    ]);
    expect(result.appliedSwaps).toHaveLength(0);
    expect(result.rejectedSwaps[0].rejection_code).toBe('WOULD_VIOLATE_AREA_MISMATCH');
  });

  it('swap that would push minor over 18h → rejected', () => {
    // Corrected fixture: minor has Mon-Wed availability, and we use a longer
    // second template (t2) so swap math actually exceeds the 18h cap.
    const minorCtx = {
      ...ctx,
      employees: [
        ...ctx.employees,
        { id: 'eMinor', name: 'M', position: 'Server', area: null, max_weekly_hours: 18,
          date_of_birth: '2010-01-01', is_minor: true },
      ],
      availability: {
        ...ctx.availability,
        'eMinor': {
          1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' },
          2: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' },
          3: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' },
        },
      },
      templates: [
        ...ctx.templates,
        { id: 't2', name: 'D', position: 'Server', area: null,
          start_time: '10:00:00', end_time: '22:30:00', days_of_week: [1, 2, 3] },
      ],
    };
    const shifts = [
      // Minor currently has s1 (Mon, 6.5h) + s2 (Tue, 6.5h) = 13h
      { id: 's1', employee_id: 'eMinor', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 's2', employee_id: 'eMinor', template_id: 't1', day: '2026-06-09',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      // eA has the long Wed shift (12.5h)
      { id: 's3', employee_id: 'eA', template_id: 't2', day: '2026-06-10',
        start_time: '10:00:00', end_time: '22:30:00', position: 'Server' },
    ];
    // Swap s3 ↔ s1: minor would have s2 (6.5h) + s3 (12.5h) = 19h, exceeding 18h cap
    const result = applySwapsToSchedule(shifts, minorCtx, [
      { shift_a_id: 's3', shift_b_id: 's1', reason: 'manager wants minor on Wed' },
    ]);
    expect(result.appliedSwaps).toHaveLength(0);
    expect(result.rejectedSwaps[0].rejection_code).toBe('WOULD_VIOLATE_HOURS_EXCEED_WEEKLY_CAP');
  });
});

describe('applyPreferences — end-to-end with mocked LLM', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it('legal swap → applied, break after round 1 (all proposed applied)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          swaps: [{ shift_a_id: 's1', shift_b_id: 's2', reason: 'preference' }],
        }) } }],
      }), { status: 200 });
    });

    const shifts: IdentifiedShift[] = [
      { id: 's1', employee_id: 'eA', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 's2', employee_id: 'eB', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const llmCtx: ScheduleContext = {
      restaurantId: 'r1', weekStart: '2026-06-08',
      requiredStaff: new Map(), lockedShifts: [], priorPatterns: [],
      weeklySalesHistory: [], hourlySalesHistory: [],
      targetLaborPercentage: 0.3, minimumWageCents: 1500,
      employees: [
        { id: 'eA', name: 'A', position: 'Server', area: null, max_weekly_hours: 40,
          date_of_birth: '1990-01-01', is_minor: false },
        { id: 'eB', name: 'B', position: 'Server', area: null, max_weekly_hours: 40,
          date_of_birth: '1990-01-01', is_minor: false },
      ],
      availability: {
        'eA': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
        'eB': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
      },
      excludedEmployeeIds: new Set(),
      templates: [],
    };

    const result = await applyPreferences(shifts, llmCtx, 'A and B should swap', [
      { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000 },
    ]);

    expect(result.appliedSwaps).toHaveLength(1);
    expect(result.modelUsed).toBe('google/gemini-2.5-flash');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('malformed LLM JSON → no swaps applied, no throw', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'this is not json' } }],
      }), { status: 200 });
    });

    const malCtx: ScheduleContext = {
      restaurantId: 'r1', weekStart: '2026-06-08',
      requiredStaff: new Map(), lockedShifts: [], priorPatterns: [],
      weeklySalesHistory: [], hourlySalesHistory: [],
      targetLaborPercentage: 0.3, minimumWageCents: 1500,
      employees: [], templates: [], availability: {}, excludedEmployeeIds: new Set(),
    };
    const result = await applyPreferences([], malCtx, 'do something', [
      { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000 },
    ]);
    expect(result.appliedSwaps).toEqual([]);
    expect(result.rejectedSwaps).toEqual([]);
    fetchMock.mockRestore();
  });
});
