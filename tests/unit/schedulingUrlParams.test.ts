import { describe, it, expect } from 'vitest';
import {
  SCHEDULING_TABS,
  SCHEDULING_PARAMS,
  parseTab,
  parseGroupBy,
  parsePlannerView,
  parseIsoDay,
  parseFlag,
  parseFreeText,
  tabParam,
  areaParam,
  positionParam,
  groupParam,
  dayParam,
  viewParam,
  plannerAreaParam,
  hiddenParam,
  timelineGroupParam,
  templateParam,
  weekParam,
} from '@/lib/schedulingUrlParams';

describe('schedulingUrlParams', () => {
  it('lists the 6 tabs', () => {
    expect([...SCHEDULING_TABS]).toEqual([
      'schedule', 'timeoff', 'availability', 'trades', 'planner', 'templates',
    ]);
  });

  it('uses a unique key for each param', () => {
    const values = Object.values(SCHEDULING_PARAMS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('parseTab accepts each tab and rejects other text', () => {
    for (const t of SCHEDULING_TABS) expect(parseTab(t)).toBe(t);
    expect(parseTab('nope')).toBeNull();
    expect(parseTab('')).toBeNull();
    expect(parseTab(null)).toBeNull();
  });

  it('parseGroupBy accepts none, area, position', () => {
    expect(parseGroupBy('none')).toBe('none');
    expect(parseGroupBy('area')).toBe('area');
    expect(parseGroupBy('position')).toBe('position');
    expect(parseGroupBy('x')).toBeNull();
    expect(parseGroupBy(null)).toBeNull();
  });

  it('parsePlannerView accepts plan and timeline', () => {
    expect(parsePlannerView('plan')).toBe('plan');
    expect(parsePlannerView('timeline')).toBe('timeline');
    expect(parsePlannerView('grid')).toBeNull();
  });

  it('parseIsoDay accepts a real date only', () => {
    expect(parseIsoDay('2026-02-27')).toBe('2026-02-27');
    expect(parseIsoDay('2024-02-29')).toBe('2024-02-29');
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('2026-13-01')).toBeNull();
    expect(parseIsoDay('26-02-27')).toBeNull();
    expect(parseIsoDay('tomorrow')).toBeNull();
    expect(parseIsoDay(null)).toBeNull();
  });

  it('parseFlag accepts only 1', () => {
    expect(parseFlag('1')).toBe('1');
    expect(parseFlag('0')).toBeNull();
    expect(parseFlag('true')).toBeNull();
    expect(parseFlag(null)).toBeNull();
  });

  it('parseFreeText accepts 1 to 200 characters', () => {
    expect(parseFreeText('Kitchen')).toBe('Kitchen');
    expect(parseFreeText('a'.repeat(200))).toBe('a'.repeat(200));
    expect(parseFreeText('a'.repeat(201))).toBeNull();
    expect(parseFreeText('')).toBeNull();
    expect(parseFreeText(null)).toBeNull();
  });

  it('exposes a spec for each param', () => {
    expect(tabParam).toMatchObject({ key: 'tab', fallback: 'schedule' });
    expect(areaParam).toMatchObject({ key: 'area', fallback: 'all' });
    expect(positionParam).toMatchObject({ key: 'position', fallback: 'all' });
    expect(groupParam).toMatchObject({ key: 'group', keepDefault: true });
    expect(dayParam).toMatchObject({ key: 'day', fallback: '' });
    expect(viewParam).toMatchObject({ key: 'view', fallback: 'plan' });
    expect(plannerAreaParam).toMatchObject({ key: 'plannerArea', fallback: 'all' });
    expect(hiddenParam).toMatchObject({ key: 'hidden', fallback: '' });
    expect(timelineGroupParam).toMatchObject({ key: 'timelineGroup', fallback: 'area' });
    expect(templateParam).toMatchObject({ key: 'template', fallback: '' });
    expect(weekParam).toMatchObject({ key: 'week', fallback: '' });
  });

  it('uses module-level parse functions with stable identity', () => {
    expect(tabParam.parse).toBe(parseTab);
    expect(groupParam.parse).toBe(parseGroupBy);
    expect(dayParam.parse).toBe(parseIsoDay);
    expect(hiddenParam.parse).toBe(parseFlag);
    expect(areaParam.parse).toBe(parseFreeText);
  });
});
