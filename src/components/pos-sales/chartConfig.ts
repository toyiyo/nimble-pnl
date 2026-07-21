import type { ChartConfig } from '@/components/ui/chart';
import { posColor, posLabel } from '@/lib/posColors';

/**
 * Build a shadcn `ChartConfig` keyed by `pos_system`, so `dataKey="<pos>"` +
 * `fill="var(--color-<pos>)"` on each `<Bar>`/`<Line>` resolve to the shared
 * `posColor`/`posLabel` registry (design §4.2).
 */
export function buildPosChartConfig(posSystems: string[]): ChartConfig {
  const config: ChartConfig = {};
  for (const pos of posSystems) {
    config[pos] = { label: posLabel(pos), color: posColor(pos) };
  }
  return config;
}
