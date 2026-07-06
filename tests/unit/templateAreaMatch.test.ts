import { describe, it, expect } from 'vitest';
import { isAreaCompatible, pickAreaPreferredMatch } from '@/lib/templateAreaMatch';

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
