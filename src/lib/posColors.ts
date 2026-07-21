import type { POSSystemType } from '@/types/pos';

/**
 * Deterministic POS system -> chart color registry.
 *
 * Maps each `POSSystemType` to an `hsl(var(--chart-N))` token so every panel
 * (stacked bars, legends, product-row dots) renders the same POS with the
 * same color. Only 5 `--chart-*` tokens exist (see src/index.css), so systems
 * without a dedicated hue share `--muted-foreground`:
 * - `manual` / `manual_upload` are not real POS integrations.
 * - `resy` has no dedicated color/adapter built yet (no useResy-style hook or
 *   sync component exists in this codebase) and was not assigned a token in the
 *   approved design doc, which enumerates only toast/square/clover/revel/shift4.
 *   Grouping it with the muted bucket (rather than reusing e.g. `--chart-1`)
 *   avoids a legend collision with clover if both ever appear in the same
 *   restaurant's data.
 */
export const POS_COLOR: Record<POSSystemType, string> = {
  toast: 'hsl(var(--chart-4))',
  square: 'hsl(var(--chart-3))',
  clover: 'hsl(var(--chart-1))',
  revel: 'hsl(var(--chart-2))',
  shift4: 'hsl(var(--chart-5))',
  resy: 'hsl(var(--muted-foreground))',
  manual: 'hsl(var(--muted-foreground))',
  manual_upload: 'hsl(var(--muted-foreground))',
};

/** Fallback color for values outside the known `POSSystemType` union. */
const FALLBACK_COLOR = 'hsl(var(--muted-foreground))';

/** Human-readable display names for each POS system. */
const POS_LABEL: Record<POSSystemType, string> = {
  toast: 'Toast',
  square: 'Square',
  clover: 'Clover',
  revel: 'Revel',
  shift4: 'Shift4',
  resy: 'Resy',
  manual: 'Manual',
  manual_upload: 'Manual',
};

/** Fallback label for values outside the known `POSSystemType` union. */
const FALLBACK_LABEL = 'Other';

/**
 * Resolve the chart color for a POS system, with a stable fallback for
 * unknown/malformed values (e.g. bad data from an untyped RPC payload).
 */
export function posColor(sys: POSSystemType): string {
  return (sys && POS_COLOR[sys]) || FALLBACK_COLOR;
}

/**
 * Resolve the display label for a POS system, with a stable fallback for
 * unknown/malformed values.
 */
export function posLabel(sys: POSSystemType): string {
  return (sys && POS_LABEL[sys]) || FALLBACK_LABEL;
}
