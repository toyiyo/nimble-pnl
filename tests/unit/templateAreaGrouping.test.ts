import { describe, it, expect } from 'vitest';
import { groupTemplatesByArea, getTemplateAreas } from '@/lib/templateAreaGrouping';
import type { ShiftTemplate } from '@/types/scheduling';

const makeTemplate = (overrides: Partial<ShiftTemplate>): ShiftTemplate => ({
  id: crypto.randomUUID(),
  restaurant_id: 'r1',
  name: 'Test',
  days: [1, 2, 3],
  start_time: '09:00',
  end_time: '17:00',
  break_duration: 0,
  position: 'Server',
  capacity: 1,
  is_active: true,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('groupTemplatesByArea', () => {
  it('groups templates by area with Unassigned last', () => {
    const templates = [
      makeTemplate({ name: 'A', area: 'Kitchen' }),
      makeTemplate({ name: 'B', area: undefined }),
      makeTemplate({ name: 'C', area: 'Front of House' }),
      makeTemplate({ name: 'D', area: 'Kitchen' }),
    ];
    const groups = groupTemplatesByArea(templates);
    expect(groups.map((g) => g.area)).toEqual(['Front of House', 'Kitchen', 'Unassigned']);
    expect(groups[1].templates.map((t) => t.name)).toEqual(['A', 'D']);
    expect(groups[2].templates.map((t) => t.name)).toEqual(['B']);
  });

  it('returns single Unassigned group when no areas set', () => {
    const templates = [makeTemplate({ name: 'X' }), makeTemplate({ name: 'Y' })];
    const groups = groupTemplatesByArea(templates);
    expect(groups).toHaveLength(1);
    expect(groups[0].area).toBe('Unassigned');
  });

  it('returns empty array for no templates', () => {
    expect(groupTemplatesByArea([])).toEqual([]);
  });

  it('filters by area when areaFilter is provided', () => {
    const templates = [
      makeTemplate({ name: 'A', area: 'Kitchen' }),
      makeTemplate({ name: 'B', area: 'Front of House' }),
    ];
    const groups = groupTemplatesByArea(templates, 'Kitchen');
    expect(groups).toHaveLength(1);
    expect(groups[0].area).toBe('Kitchen');
    expect(groups[0].templates).toHaveLength(1);
  });
});

describe('getTemplateAreas', () => {
  it('returns sorted unique area names', () => {
    const templates = [
      makeTemplate({ area: 'Kitchen' }),
      makeTemplate({ area: 'Bar' }),
      makeTemplate({ area: 'Kitchen' }),
      makeTemplate({ area: undefined }),
    ];
    expect(getTemplateAreas(templates)).toEqual(['Bar', 'Kitchen']);
  });

  it('returns empty for no areas', () => {
    expect(getTemplateAreas([makeTemplate({})])).toEqual([]);
  });
});
