import { useEffect } from 'react';
import type {
  PoolingModel,
  ShareMethod,
  SplitCadence,
  TipPoolSettings,
  TipSource,
} from '@/hooks/useTipPoolSettings';
import type { RoleAllocationRule } from '@/utils/tipPooling';
import { stableStringify } from '@/utils/tipSettingsSync';

type Params = {
  settings: TipPoolSettings | null;
  tipSource: TipSource;
  shareMethod: ShareMethod;
  splitCadence: SplitCadence;
  roleWeights: Record<string, number>;
  rolePercentages: Record<string, RoleAllocationRule>;
  selectedEmployees: Set<string>;
  poolingModel?: PoolingModel;
  /** True while a save is in flight. No new save starts until it settles. */
  isSaving?: boolean;
  onSave: () => void;
};

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
  isSaving = false,
  onSave,
}: Params) {
  useEffect(() => {
    // Wait for the save in flight. Its result gives `settings` an id, so the
    // next save updates that row instead of inserting a second one. This
    // effect runs again when `isSaving` goes back to false.
    if (isSaving) return;

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
  }, [settings, tipSource, shareMethod, splitCadence, roleWeights, rolePercentages, selectedEmployees, poolingModel, isSaving, onSave]);
}
