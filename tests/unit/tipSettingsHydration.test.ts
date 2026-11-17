import { describe, it, expect } from 'vitest';
import { shouldHydrateTipSettings, tipSettingsKey } from '@/utils/tipSettingsSync';

const base = {
  tipSource: 'manual' as const,
  shareMethod: 'hours' as const,
  splitCadence: 'daily' as const,
  poolingModel: 'full_pool' as const,
  roleWeights: { Server: 1 },
  rolePercentages: {},
  enabledEmployeeIds: ['b', 'a'],
};

describe('tipSettingsKey', () => {
  it('ignores the order of employee ids and of map keys', () => {
    expect(
      tipSettingsKey({ ...base, enabledEmployeeIds: ['a', 'b'], roleWeights: { Server: 1, Host: 0.5 } }),
    ).toBe(tipSettingsKey({ ...base, enabledEmployeeIds: new Set(['b', 'a']), roleWeights: { Host: 0.5, Server: 1 } }));
  });

  it('changes when a role rule changes', () => {
    expect(tipSettingsKey(base)).not.toBe(
      tipSettingsKey({ ...base, rolePercentages: { Manager: { mode: 'at_least', percentage: 30 } } }),
    );
  });
});

describe('shouldHydrateTipSettings', () => {
  const saved = tipSettingsKey(base);
  const edited = tipSettingsKey({ ...base, rolePercentages: { Manager: { mode: 'exactly', percentage: 30 } } });
  const otherServerRow = tipSettingsKey({ ...base, shareMethod: 'role' });

  it('hydrates on the first load', () => {
    expect(shouldHydrateTipSettings({ lastHydratedKey: null, localKey: edited, incomingKey: saved })).toBe(true);
  });

  it('hydrates when the local state has no unsaved edit', () => {
    expect(shouldHydrateTipSettings({ lastHydratedKey: saved, localKey: saved, incomingKey: otherServerRow })).toBe(true);
  });

  it('hydrates when the server row already matches the local state', () => {
    expect(shouldHydrateTipSettings({ lastHydratedKey: saved, localKey: edited, incomingKey: edited })).toBe(true);
  });

  it('does NOT hydrate over an unsaved local edit (the refetch race)', () => {
    // The manager picks a role rule. Before the 1s autosave, a refetch of an
    // older save arrives. Hydration must not put the old rule back.
    expect(shouldHydrateTipSettings({ lastHydratedKey: saved, localKey: edited, incomingKey: saved })).toBe(false);
  });
});
