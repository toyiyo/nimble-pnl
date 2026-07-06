import { describe, it, expect } from 'vitest';
import { isAreaCompatible, pickAreaPreferredMatch, findAreaAwareTemplate } from '@/lib/templateAreaMatch';
import type { ShiftMatchKey } from '@/lib/templateAreaMatch';

describe('isAreaCompatible', () => {
  it('should match when template and employee share the same area', () => {
    expect(isAreaCompatible('Cold Stone', 'Cold Stone')).toBe(true);
  });

  it('should not match when both areas are set but differ', () => {
    expect(isAreaCompatible('Cold Stone', "Wetzel's")).toBe(false);
  });

  it('should match permissively when the template has no area', () => {
    expect(isAreaCompatible(null, "Wetzel's")).toBe(true);
    expect(isAreaCompatible(undefined, "Wetzel's")).toBe(true);
  });

  it('should match permissively when the employee has no area', () => {
    expect(isAreaCompatible('Cold Stone', null)).toBe(true);
    expect(isAreaCompatible('Cold Stone', undefined)).toBe(true);
  });
});

describe('pickAreaPreferredMatch', () => {
  // Callers pass candidates already filtered to area-compatible templates.
  const wtz = { id: 'wtz', area: "Wetzel's" };
  const generic = { id: 'generic', area: null };

  it('CRITICAL: should prefer an exact same-area match over an area-agnostic one listed first', () => {
    // generic (null-area) comes first but the employee-area match must win.
    expect(pickAreaPreferredMatch([generic, wtz], "Wetzel's")?.id).toBe('wtz');
  });

  it('should fall back to the first candidate when no exact same-area match exists', () => {
    expect(pickAreaPreferredMatch([generic], "Wetzel's")?.id).toBe('generic');
  });

  it('should return the first candidate when the employee has no area', () => {
    // Nothing to prefer — preserve input order.
    expect(pickAreaPreferredMatch([generic, wtz], null)?.id).toBe('generic');
  });

  it('should return undefined when there are no candidates', () => {
    expect(pickAreaPreferredMatch([], "Wetzel's")).toBeUndefined();
  });
});

describe('findAreaAwareTemplate', () => {
  const cscPrep = { id: 't-csc', start_time: '10:00:00', end_time: '16:00:00', position: 'Server', days: [0, 5, 6], area: 'Cold Stone' };
  const wtzOpen = { id: 't-wtz', start_time: '10:00:00', end_time: '16:00:00', position: 'Server', days: [0, 5, 6], area: "Wetzel's" };
  const generic = { id: 't-gen', start_time: '10:00:00', end_time: '16:00:00', position: 'Server', days: [0, 5, 6], area: null };
  // Saturday is day 6.
  const key = (employeeArea: string | null): ShiftMatchKey => ({
    shiftStart: '10:00:00', shiftEnd: '16:00:00', position: 'Server', dayOfWeek: 6, employeeArea,
  });

  it('CRITICAL: should not match a cross-area template', () => {
    expect(findAreaAwareTemplate([cscPrep], key("Wetzel's"))).toBeUndefined();
  });

  it('CRITICAL: should prefer the same-area template over a cross-area and an area-agnostic one', () => {
    expect(findAreaAwareTemplate([generic, cscPrep, wtzOpen], key("Wetzel's"))?.id).toBe('t-wtz');
  });

  it('should not match when the day is not in template.days', () => {
    // Monday (day 1) is not in [0,5,6].
    expect(findAreaAwareTemplate([wtzOpen], { ...key("Wetzel's"), dayOfWeek: 1 })).toBeUndefined();
  });

  it('should not match when start/end/position differ', () => {
    expect(findAreaAwareTemplate([wtzOpen], { ...key("Wetzel's"), shiftEnd: '17:00:00' })).toBeUndefined();
    expect(findAreaAwareTemplate([wtzOpen], { ...key("Wetzel's"), position: 'Cook' })).toBeUndefined();
  });

  it('should match permissively when employee or template area is null', () => {
    expect(findAreaAwareTemplate([cscPrep], key(null))?.id).toBe('t-csc');
    expect(findAreaAwareTemplate([generic], key("Wetzel's"))?.id).toBe('t-gen');
  });
});
