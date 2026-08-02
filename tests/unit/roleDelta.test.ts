import { describe, it, expect } from 'vitest';
import { roleDelta } from '@/lib/permissions/roleDelta';
import type { RoleGrantSet } from '@/lib/permissions/roleDelta';

const set = (
  areas: RoleGrantSet['areas'],
  flags: RoleGrantSet['flags'] = []
): RoleGrantSet => ({ areas, flags });

describe('roleDelta', () => {
  it('reports a newly granted area as a gain, with its human label', () => {
    const d = roleDelta(set([]), set([{ area_key: 'recipes', level: 'manage' }]));
    expect(d.gains).toHaveLength(1);
    expect(d.gains[0]).toMatchObject({ from: null, to: 'manage' });
    expect(d.gains[0].label).toBeTruthy();
    expect(d.loses).toHaveLength(0);
    expect(d.isSame).toBe(false);
  });

  it('reports a removed area as a loss', () => {
    const d = roleDelta(set([{ area_key: 'recipes', level: 'manage' }]), set([]));
    expect(d.loses).toHaveLength(1);
    expect(d.loses[0]).toMatchObject({ from: 'manage', to: null });
    expect(d.gains).toHaveLength(0);
  });

  it('treats view -> manage as a gain rather than collapsing it', () => {
    const d = roleDelta(
      set([{ area_key: 'recipes', level: 'view' }]),
      set([{ area_key: 'recipes', level: 'manage' }])
    );
    expect(d.gains).toHaveLength(1);
    expect(d.gains[0]).toMatchObject({ from: 'view', to: 'manage' });
  });

  it('treats manage -> view as a loss', () => {
    const d = roleDelta(
      set([{ area_key: 'recipes', level: 'manage' }]),
      set([{ area_key: 'recipes', level: 'view' }])
    );
    expect(d.loses).toHaveLength(1);
    expect(d.loses[0]).toMatchObject({ from: 'manage', to: 'view' });
  });

  it('reports identical grants as the same', () => {
    const areas = [{ area_key: 'recipes' as const, level: 'manage' as const }];
    const d = roleDelta(set(areas, ['view:costs']), set(areas, ['view:costs']));
    expect(d.isSame).toBe(true);
    expect(d.gains).toHaveLength(0);
    expect(d.loses).toHaveLength(0);
    expect(d.flagGains).toHaveLength(0);
    expect(d.flagLoses).toHaveLength(0);
  });

  // The case this function exists for. Identical areas, one flag different.
  // buildRolePreview's summary would read the same for both, because its
  // blocked-list checks only view:costs — so a summary diff would report
  // "nothing changed" while pay-rate visibility changed hands.
  it.each([
    ['view:costs'],
    ['view:pay_rates'],
    ['view:employee_pii'],
  ] as const)('detects a flag-only change: %s', (flag) => {
    const areas = [{ area_key: 'employees' as const, level: 'view' as const }];
    const gained = roleDelta(set(areas, []), set(areas, [flag]));
    expect(gained.isSame).toBe(false);
    expect(gained.flagGains.map((f) => f.flag)).toEqual([flag]);
    expect(gained.gains).toHaveLength(0);

    const lost = roleDelta(set(areas, [flag]), set(areas, []));
    expect(lost.isSame).toBe(false);
    expect(lost.flagLoses.map((f) => f.flag)).toEqual([flag]);
  });

  it('every flag carries a human label, not the raw literal', () => {
    const areas = [{ area_key: 'employees' as const, level: 'view' as const }];
    const d = roleDelta(set(areas, []), set(areas, ['view:pay_rates']));
    expect(d.flagGains[0].label).toBe('Employee pay rates');
  });
});
