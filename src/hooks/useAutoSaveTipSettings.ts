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
        JSON.stringify(roleWeights) !== JSON.stringify(settings.role_weights) ||
        JSON.stringify(rolePercentages) !== JSON.stringify(settings.role_percentages ?? {}) ||
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
