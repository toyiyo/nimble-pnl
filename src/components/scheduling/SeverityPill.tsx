import type { Severity } from '@/lib/scheduling/deletionCopy';

/**
 * "High impact" / "Low impact" badge shared by the two impact-aware deletion
 * dialogs (DeleteTemplateDialog, DeleteAvailabilityDialog) — identical
 * markup, keyed on the same `Severity` the deletionCopy helpers derive.
 */
export function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span
      className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
        severity === 'high'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {severity === 'high' ? 'High impact' : 'Low impact'}
    </span>
  );
}
