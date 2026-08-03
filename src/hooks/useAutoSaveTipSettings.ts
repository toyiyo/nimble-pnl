import { useEffect } from 'react';
import type {
  PoolingModel,
  ShareMethod,
  SplitCadence,
  TipPoolSettings,
  TipSource,
} from '@/hooks/useTipPoolSettings';
import type { RoleAllocationRule } from '@/utils/tipPooling';

type Params = {
  settings: TipPoolSettings | null;
  tipSource: TipSource;
  shareMethod: ShareMethod;
  splitCadence: SplitCadence;
  roleWeights: Record<string, number>;
  rolePercentages: Record<string, RoleAllocationRule>;
  selectedEmployees: Set<string>;
  poolingModel?: PoolingModel;
  onSave: () => void;
};

/**
 * `JSON.stringify` with object keys emitted in sorted order.
 *
 * Postgres `jsonb` does not preserve key insertion order — it stores keys sorted
 * by length then bytewise — so a map that round-trips through the database comes
 * back reordered. Comparing raw `JSON.stringify` output would read that
 * reordering as a change and schedule a pointless save every time settings load.
 */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    const source = val as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort((a, b) => a.localeCompare(b))
        .map(key => [key, source[key]]),
    );
  });

/**
 * Debounced auto-save for tip pooling settings.
 * Triggers a save when local state diverges from persisted settings.
 */
export function useAutoSaveTipSettings({
  settings,
  tipSource,
  shareMethod,
  splitCadence,
  roleWeights,
  rolePercentages,
  selectedEmployees,
  poolingModel,
  onSave,
}: Params) {
  useEffect(() => {
    const sortedIds = (ids: Iterable<string>) => [...ids].sort((a, b) => a.localeCompare(b)).join(',');

    const hasChanges = settings
      ? tipSource !== settings.tip_source ||
        shareMethod !== settings.share_method ||
        splitCadence !== settings.split_cadence ||
        (poolingModel !== undefined && poolingModel !== settings.pooling_model) ||
        stableStringify(roleWeights) !== stableStringify(settings.role_weights) ||
        stableStringify(rolePercentages) !== stableStringify(settings.role_percentages ?? {}) ||
        sortedIds(selectedEmployees) !== sortedIds(settings.enabled_employee_ids ?? [])
      : selectedEmployees.size > 0 ||
        tipSource !== 'manual' ||
        shareMethod !== 'hours' ||
        splitCadence !== 'daily' ||
        (poolingModel !== undefined && poolingModel !== 'full_pool') ||
        Object.keys(rolePercentages).length > 0;

    if (!hasChanges) return;

    const timeoutId = setTimeout(() => {
      onSave();
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [settings, tipSource, shareMethod, splitCadence, roleWeights, rolePercentages, selectedEmployees, poolingModel, onSave]);
}
