import type {
  PoolingModel,
  RoleAllocationRule,
  ShareMethod,
} from '@/utils/tipPooling';
import type { SplitCadence, TipSource } from '@/hooks/useTipPoolSettings';

/**
 * `JSON.stringify` with object keys emitted in sorted order.
 *
 * Postgres `jsonb` does not preserve key insertion order — it stores keys sorted
 * by length then bytewise — so a map that round-trips through the database comes
 * back reordered. Comparing raw `JSON.stringify` output would read that
 * reordering as a change and schedule a pointless save every time settings load.
 */
export const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    const source = val as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort((a, b) => a.localeCompare(b))
        .map(key => [key, source[key]]),
    );
  });

/** The tip settings fields that the Tips page edits and the autosave writes. */
export type TipSettingsFields = {
  tipSource: TipSource;
  shareMethod: ShareMethod;
  splitCadence: SplitCadence;
  poolingModel: PoolingModel;
  roleWeights: Record<string, number>;
  rolePercentages: Record<string, RoleAllocationRule>;
  enabledEmployeeIds: Iterable<string>;
};

/**
 * A comparison key for a set of tip settings. Two keys are equal when the
 * settings are equal, whatever the order of map keys or employee ids.
 */
export const tipSettingsKey = (fields: TipSettingsFields): string =>
  stableStringify({
    ...fields,
    enabledEmployeeIds: [...fields.enabledEmployeeIds].sort((a, b) => a.localeCompare(b)),
  });

/**
 * Decide if a settings row from the server may replace the local edit state.
 *
 * The Tips page copies each fetched settings row into local state. A refetch
 * can arrive after the manager changes a setting but before the 1s autosave
 * writes it. If the page copies that older row, the edit is lost and the
 * autosave sees no change to write. So copy the row only when one is true:
 * - this is the first row for the restaurant (`lastHydratedKey` is null),
 * - the local state has no unsaved edit (it equals the last row copied),
 * - the row already equals the local state.
 */
export function shouldHydrateTipSettings({
  lastHydratedKey,
  localKey,
  incomingKey,
}: {
  lastHydratedKey: string | null;
  localKey: string;
  incomingKey: string;
}): boolean {
  return lastHydratedKey === null || localKey === lastHydratedKey || localKey === incomingKey;
}

