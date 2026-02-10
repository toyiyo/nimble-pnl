import { useEffect } from 'react';
import type {
  ShareMethod,
  SplitCadence,
  TipPoolSettings,
  TipSource,
} from '@/hooks/useTipPoolSettings';

type Params = {
  settings: TipPoolSettings | null;
  tipSource: TipSource;
  shareMethod: ShareMethod;
  splitCadence: SplitCadence;
  roleWeights: Record<string, number>;
  selectedEmployees: Set<string>;
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
  selectedEmployees,
  onSave,
}: Params) {
  useEffect(() => {
    // If no settings exist, this is first-time setup - save after user makes selections
    const hasChanges = settings
      ? // Compare with existing settings
        tipSource !== settings.tip_source ||
        shareMethod !== settings.share_method ||
        splitCadence !== settings.split_cadence ||
        JSON.stringify(roleWeights) !== JSON.stringify(settings.role_weights) ||
        JSON.stringify(Array.from(selectedEmployees).sort((a, b) => a.localeCompare(b))) !==
          JSON.stringify((settings.enabled_employee_ids || []).sort((a, b) => a.localeCompare(b)))
      : // No settings exist - trigger save if user has selected non-default values
        // Only save if user has actually interacted (e.g., changed from default 'manual')
        selectedEmployees.size > 0; // If employees selected, assume user has configured

    if (!hasChanges) return;

    const timeoutId = setTimeout(() => {
      onSave();
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [settings, tipSource, shareMethod, splitCadence, roleWeights, selectedEmployees, onSave]);
}
