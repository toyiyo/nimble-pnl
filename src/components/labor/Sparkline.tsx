import { cn } from '@/lib/utils';

interface SparklineProps {
  /** Series values; `null` entries render as a gap (no interpolated segment). */
  readonly values: readonly (number | null)[];
  readonly className?: string;
}

/**
 * Minimal inline-SVG sparkline for the KPI tiles — a hand-rolled polyline
 * (rather than a Recharts instance per tile) so a row of four stays cheap.
 * Strokes with `currentColor`, so the caller sets tone via a `text-…` class
 * (e.g. `balanceStateClassName`). Decorative — `aria-hidden`; the tile's number
 * carries the value for assistive tech.
 */
export function Sparkline({ values, className }: SparklineProps) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < 2) return null;

  const w = 72;
  const h = 22;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const n = values.length;

  let d = '';
  let penDown = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      penDown = false;
      return;
    }
    const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    d += `${penDown ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    penDown = true;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-5 w-[72px] shrink-0', className)} aria-hidden="true" preserveAspectRatio="none">
      <path d={d.trim()} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
