import { useId } from 'react';

import { Label } from '@/components/ui/label';

import { impliedLabor, laborConsistentSplh } from '@/lib/coverageChartModel';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Slider bounds/step (design doc §B): 25–120 brackets the labor-consistent
 * value with headroom for typical wage/target combinations. The saved
 * `target_splh` value is clamped only for *display* position (thumb/notch
 * placement below) — the underlying number the caller persists is never
 * force-clamped here.
 */
export const SPLH_SLIDER_MIN = 25;
export const SPLH_SLIDER_MAX = 120;
export const SPLH_SLIDER_STEP = 5;

/** Clamp a $/hr value into the slider's display range, for positioning only. */
function clampForDisplay(v: number): number {
  return Math.min(SPLH_SLIDER_MAX, Math.max(SPLH_SLIDER_MIN, v));
}

/** Percentage-of-track position for a $/hr value, clamped for display. */
function trackPct(v: number): number {
  return ((clampForDisplay(v) - SPLH_SLIDER_MIN) / (SPLH_SLIDER_MAX - SPLH_SLIDER_MIN)) * 100;
}

// ── Component ────────────────────────────────────────────────────────────────

interface SplhSliderProps {
  /** Current preview SPLH target, in dollars/hour. */
  readonly value: number;
  /** Average hourly wage across employees — drives the implied-labor readout and notch. */
  readonly wage: number;
  /** Target labor % from staffing settings — drives the pill threshold and notch label. */
  readonly targetLaborPct: number;
  /**
   * Whether the signed-in user may persist changes (manager/owner role gate —
   * computed by the caller, not this component). `false` hides the Save
   * button entirely; live preview + Reset stay available to everyone (design
   * doc §Design-review resolutions #6).
   */
  readonly canSave: boolean;
  /** Pending state of the Save mutation (`useStaffingSettings().isSaving`). */
  readonly isSaving: boolean;
  /** Called with the new numeric value on every drag frame (live preview). */
  readonly onChange: (value: number) => void;
  /** Called when Save is clicked — the caller persists `value` via `updateSettings`. */
  readonly onSave: () => void;
  /** Called when Reset is clicked — the caller restores the saved `target_splh`. */
  readonly onReset: () => void;
}

/**
 * On-chart SPLH target slider + live implied-labor readout (design doc §B).
 *
 * A native `<input type="range">` (25–120 step 5) drives `onChange` on every
 * drag frame so the caller can re-run the whole staffing pipeline live — this
 * component holds no derived staffing state of its own, only the pure
 * `impliedLabor`/`laborConsistentSplh` math from `coverageChartModel`.
 *
 * The notch marks the SPLH value that would exactly hit `targetLaborPct` at
 * `wage` (`laborConsistentSplh`), so a manager can see at a glance where their
 * own labor goal sits relative to the current knob position.
 */
export function SplhSlider({
  value,
  wage,
  targetLaborPct,
  canSave,
  isSaving,
  onChange,
  onSave,
  onReset,
}: SplhSliderProps) {
  const sliderId = useId();

  const { pct, overTarget } = impliedLabor({ wage, splh: value, targetLaborPct });
  const consistent = laborConsistentSplh({ wage, targetLaborPct });
  const notchPct = trackPct(consistent);
  const pctLabel = pct.toFixed(1);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label
          htmlFor={sliderId}
          className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
        >
          Sales per Labor Hour
        </Label>

        <div className="flex items-center gap-2">
          <span className="text-[13px] text-foreground tabular-nums">
            → {pctLabel}% labor at ${wage.toFixed(2)}/hr
          </span>
          <span
            data-testid="splh-slider-pill"
            className={cn(
              'text-[11px] font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap',
              overTarget ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success',
            )}
          >
            {overTarget ? 'Over target' : 'On target'}
          </span>
        </div>
      </div>

      <div className="relative pt-4 pb-1">
        {/* Labor-consistent notch — display-clamped into the 25–120 track (never persisted) */}
        <div
          data-testid="splh-slider-notch"
          className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${notchPct}%` }}
          aria-hidden="true"
        >
          <span className="whitespace-nowrap text-[10px] text-muted-foreground">
            ${Math.round(consistent)} · {targetLaborPct}% labor
          </span>
          <span className="h-2 w-px bg-muted-foreground/60" />
        </div>

        <input
          id={sliderId}
          type="range"
          min={SPLH_SLIDER_MIN}
          max={SPLH_SLIDER_MAX}
          step={SPLH_SLIDER_STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Sales per labor hour target, in dollars"
          aria-valuetext={`$${value}/hr → ${pctLabel}% labor`}
          className="w-full accent-primary"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="h-8 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset
        </button>
        {canSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            aria-label={isSaving ? 'Saving sales per labor hour target' : 'Save sales per labor hour target'}
            className="h-8 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}
