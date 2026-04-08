# Staffing Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a formula-based staffing suggestion overlay to the shift planner that recommends headcount per hour based on historical POS sales and SPLH calculations.

**Architecture:** New `staffing_settings` table stores per-restaurant labor parameters. A pure TypeScript calculator computes hourly staffing from `unified_sales` data. A collapsible overlay in `ShiftPlannerTab` visualizes recommendations and creates unassigned shifts on "Apply."

**Tech Stack:** React, TypeScript, Supabase (PostgreSQL + RLS), React Query, TailwindCSS, Recharts (bar chart), pgTAP, Vitest.

---

### Task 1: Database Migration — staffing_settings Table

**Files:**
- Create: `supabase/migrations/20260306000000_create_staffing_settings.sql`
- Test: `supabase/tests/staffing_settings.test.sql`

**Step 1: Write the pgTAP test**

```sql
-- supabase/tests/staffing_settings.test.sql
BEGIN;
SELECT plan(6);

-- Table exists
SELECT has_table('public', 'staffing_settings', 'staffing_settings table exists');

-- Required columns
SELECT has_column('public', 'staffing_settings', 'restaurant_id', 'has restaurant_id');
SELECT has_column('public', 'staffing_settings', 'target_splh', 'has target_splh');
SELECT has_column('public', 'staffing_settings', 'avg_ticket_size', 'has avg_ticket_size');
SELECT has_column('public', 'staffing_settings', 'target_labor_pct', 'has target_labor_pct');
SELECT has_column('public', 'staffing_settings', 'min_staff', 'has min_staff');

-- Unique constraint on restaurant_id
SELECT col_is_unique('public', 'staffing_settings', 'restaurant_id', 'restaurant_id is unique');

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — table does not exist

**Step 3: Write the migration**

```sql
-- supabase/migrations/20260306000000_create_staffing_settings.sql
CREATE TABLE IF NOT EXISTS public.staffing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  target_splh NUMERIC NOT NULL DEFAULT 60.00,
  avg_ticket_size NUMERIC NOT NULL DEFAULT 8.00,
  target_labor_pct NUMERIC NOT NULL DEFAULT 22.0,
  min_staff INTEGER NOT NULL DEFAULT 1,
  lookback_weeks INTEGER NOT NULL DEFAULT 4,
  manual_projections JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staffing_settings_restaurant_unique UNIQUE (restaurant_id)
);

-- RLS
ALTER TABLE public.staffing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staffing_settings_select" ON public.staffing_settings
  FOR SELECT USING (
    restaurant_id IN (
      SELECT ur.restaurant_id FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
    )
  );

CREATE POLICY "staffing_settings_insert" ON public.staffing_settings
  FOR INSERT WITH CHECK (
    restaurant_id IN (
      SELECT ur.restaurant_id FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "staffing_settings_update" ON public.staffing_settings
  FOR UPDATE USING (
    restaurant_id IN (
      SELECT ur.restaurant_id FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "staffing_settings_delete" ON public.staffing_settings
  FOR DELETE USING (
    restaurant_id IN (
      SELECT ur.restaurant_id FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- Updated_at trigger
CREATE TRIGGER set_staffing_settings_updated_at
  BEFORE UPDATE ON public.staffing_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
```

**Step 4: Reset DB and run test**

Run: `npm run db:reset && npm run test:db`
Expected: PASS — all 6 assertions

**Step 5: Commit**

```bash
git add supabase/migrations/20260306000000_create_staffing_settings.sql supabase/tests/staffing_settings.test.sql
git commit -m "feat: add staffing_settings table with RLS"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `src/types/scheduling.ts`

**Step 1: Add types**

Append to `src/types/scheduling.ts`:

```typescript
// Staffing suggestions
export interface StaffingSettings {
  id: string;
  restaurant_id: string;
  target_splh: number;
  avg_ticket_size: number;
  target_labor_pct: number;
  min_staff: number;
  lookback_weeks: number;
  manual_projections: ManualProjections | null;
  created_at: string;
  updated_at: string;
}

export interface ManualProjections {
  // Map of day-of-week (0=Sun, 6=Sat) to expected daily revenue in dollars
  [dayOfWeek: string]: number;
}

export interface HourlySalesData {
  hour: number; // 0-23
  avgSales: number; // dollars
  sampleCount: number; // how many weeks contributed
}

export interface HourlyStaffingRecommendation {
  hour: number;
  projectedSales: number;
  recommendedStaff: number;
  estimatedLaborCost: number;
  laborPct: number;
  overTarget: boolean;
}

export interface ShiftBlock {
  startHour: number;
  endHour: number;
  headcount: number;
  day: string; // YYYY-MM-DD
}
```

**Step 2: Commit**

```bash
git add src/types/scheduling.ts
git commit -m "feat: add staffing suggestion types"
```

---

### Task 3: Pure Staffing Calculator

**Files:**
- Create: `src/lib/staffingCalculator.ts`
- Test: `tests/unit/staffingCalculator.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/unit/staffingCalculator.test.ts
import { describe, it, expect } from 'vitest';
import {
  calculateRecommendedStaff,
  checkLaborGuardrail,
  consolidateIntoShiftBlocks,
  buildHourlyRecommendations,
} from '@/lib/staffingCalculator';

describe('calculateRecommendedStaff', () => {
  it('divides projected sales by target SPLH and rounds up', () => {
    expect(calculateRecommendedStaff(200, 60, 1)).toBe(4); // 200/60=3.33 → 4
  });

  it('returns minStaff when sales are low', () => {
    expect(calculateRecommendedStaff(10, 60, 2)).toBe(2); // 10/60=0.17 → 1, but min=2
  });

  it('handles zero sales by returning minStaff', () => {
    expect(calculateRecommendedStaff(0, 60, 1)).toBe(1);
  });
});

describe('checkLaborGuardrail', () => {
  it('returns false when labor pct is under target', () => {
    // 2 staff * $15/hr = $30, $200 sales → 15% < 22%
    expect(checkLaborGuardrail(2, 1500, 200, 22)).toBe(false);
  });

  it('returns true when labor pct exceeds target', () => {
    // 5 staff * $15/hr = $75, $200 sales → 37.5% > 22%
    expect(checkLaborGuardrail(5, 1500, 200, 22)).toBe(true);
  });

  it('returns false when sales are zero (avoid division by zero)', () => {
    expect(checkLaborGuardrail(1, 1500, 0, 22)).toBe(false);
  });
});

describe('consolidateIntoShiftBlocks', () => {
  it('merges contiguous hours with same headcount', () => {
    const recommendations = [
      { hour: 8, recommendedStaff: 2 },
      { hour: 9, recommendedStaff: 2 },
      { hour: 10, recommendedStaff: 2 },
      { hour: 11, recommendedStaff: 3 },
      { hour: 12, recommendedStaff: 3 },
    ];
    const blocks = consolidateIntoShiftBlocks(recommendations, '2026-03-10');
    expect(blocks).toEqual([
      { startHour: 8, endHour: 11, headcount: 2, day: '2026-03-10' },
      { startHour: 11, endHour: 13, headcount: 3, day: '2026-03-10' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(consolidateIntoShiftBlocks([], '2026-03-10')).toEqual([]);
  });

  it('splits blocks longer than 8 hours', () => {
    const recommendations = Array.from({ length: 10 }, (_, i) => ({
      hour: 8 + i,
      recommendedStaff: 2,
    }));
    const blocks = consolidateIntoShiftBlocks(recommendations, '2026-03-10');
    expect(blocks.length).toBe(2);
    expect(blocks[0].endHour - blocks[0].startHour).toBeLessThanOrEqual(8);
  });
});

describe('buildHourlyRecommendations', () => {
  it('produces recommendation for each hour with sales', () => {
    const hourlySales = [
      { hour: 11, avgSales: 200, sampleCount: 4 },
      { hour: 12, avgSales: 300, sampleCount: 4 },
    ];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result).toHaveLength(2);
    expect(result[0].hour).toBe(11);
    expect(result[0].recommendedStaff).toBe(4); // 200/60=3.33→4
    expect(result[1].recommendedStaff).toBe(5); // 300/60=5
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/staffingCalculator.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/lib/staffingCalculator.ts
import type { HourlySalesData, HourlyStaffingRecommendation, ShiftBlock } from '@/types/scheduling';

const MAX_SHIFT_HOURS = 8;

export function calculateRecommendedStaff(
  projectedSales: number,
  targetSplh: number,
  minStaff: number,
): number {
  if (projectedSales <= 0 || targetSplh <= 0) return minStaff;
  return Math.max(Math.ceil(projectedSales / targetSplh), minStaff);
}

export function checkLaborGuardrail(
  staffCount: number,
  avgHourlyRateCents: number,
  projectedSales: number,
  targetLaborPct: number,
): boolean {
  if (projectedSales <= 0) return false;
  const laborCost = staffCount * (avgHourlyRateCents / 100);
  const laborPct = (laborCost / projectedSales) * 100;
  return laborPct > targetLaborPct;
}

export function buildHourlyRecommendations(
  hourlySales: HourlySalesData[],
  params: {
    targetSplh: number;
    minStaff: number;
    avgHourlyRateCents: number;
    targetLaborPct: number;
  },
): HourlyStaffingRecommendation[] {
  return hourlySales.map(({ hour, avgSales }) => {
    const recommendedStaff = calculateRecommendedStaff(avgSales, params.targetSplh, params.minStaff);
    const estimatedLaborCost = recommendedStaff * (params.avgHourlyRateCents / 100);
    const laborPct = avgSales > 0 ? (estimatedLaborCost / avgSales) * 100 : 0;
    const overTarget = checkLaborGuardrail(
      recommendedStaff,
      params.avgHourlyRateCents,
      avgSales,
      params.targetLaborPct,
    );
    return {
      hour,
      projectedSales: avgSales,
      recommendedStaff,
      estimatedLaborCost,
      laborPct,
      overTarget,
    };
  });
}

export function consolidateIntoShiftBlocks(
  recommendations: Pick<HourlyStaffingRecommendation, 'hour' | 'recommendedStaff'>[],
  day: string,
): ShiftBlock[] {
  if (recommendations.length === 0) return [];

  const sorted = [...recommendations].sort((a, b) => a.hour - b.hour);
  const blocks: ShiftBlock[] = [];
  let currentStart = sorted[0].hour;
  let currentHeadcount = sorted[0].recommendedStaff;

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    const blockLength = (current?.hour ?? sorted[i - 1].hour + 1) - currentStart;
    const isDifferent = !current || current.recommendedStaff !== currentHeadcount;
    const isTooLong = blockLength >= MAX_SHIFT_HOURS;

    if (isDifferent || isTooLong) {
      blocks.push({
        startHour: currentStart,
        endHour: sorted[i - 1].hour + 1,
        headcount: currentHeadcount,
        day,
      });

      // Split if too long
      if (isTooLong && !isDifferent && current) {
        currentStart = current.hour;
        currentHeadcount = current.recommendedStaff;
      } else if (current) {
        currentStart = current.hour;
        currentHeadcount = current.recommendedStaff;
      }
    }
  }

  // Split any blocks that are still > MAX_SHIFT_HOURS
  const result: ShiftBlock[] = [];
  for (const block of blocks) {
    const duration = block.endHour - block.startHour;
    if (duration > MAX_SHIFT_HOURS) {
      const midpoint = block.startHour + MAX_SHIFT_HOURS;
      result.push({ ...block, endHour: midpoint });
      result.push({ ...block, startHour: midpoint });
    } else {
      result.push(block);
    }
  }

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/staffingCalculator.test.ts`
Expected: PASS — all tests

**Step 5: Commit**

```bash
git add src/lib/staffingCalculator.ts tests/unit/staffingCalculator.test.ts
git commit -m "feat: add pure staffing calculator with tests"
```

---

### Task 4: useStaffingSettings Hook

**Files:**
- Create: `src/hooks/useStaffingSettings.ts`

**Step 1: Write the hook**

```typescript
// src/hooks/useStaffingSettings.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { StaffingSettings } from '@/types/scheduling';

const DEFAULTS: Omit<StaffingSettings, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'> = {
  target_splh: 60,
  avg_ticket_size: 8,
  target_labor_pct: 22,
  min_staff: 1,
  lookback_weeks: 4,
  manual_projections: null,
};

export function useStaffingSettings(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['staffing-settings', restaurantId];

  const { data: settings, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from('staffing_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) throw error;
      return data as StaffingSettings | null;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  const upsertMutation = useMutation({
    mutationFn: async (updates: Partial<StaffingSettings>) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await supabase
        .from('staffing_settings')
        .upsert(
          { restaurant_id: restaurantId, ...updates },
          { onConflict: 'restaurant_id' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as StaffingSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Merge DB settings with defaults for consumer convenience
  const effectiveSettings = {
    ...DEFAULTS,
    ...(settings ?? {}),
  };

  return {
    settings,
    effectiveSettings,
    isLoading,
    updateSettings: upsertMutation.mutateAsync,
    isSaving: upsertMutation.isPending,
  };
}
```

**Step 2: Commit**

```bash
git add src/hooks/useStaffingSettings.ts
git commit -m "feat: add useStaffingSettings hook with upsert"
```

---

### Task 5: useHourlySalesPattern Hook

**Files:**
- Create: `src/hooks/useHourlySalesPattern.ts`
- Test: `tests/unit/useHourlySalesPattern.test.ts`

**Step 1: Write the test for the pure aggregation helper**

```typescript
// tests/unit/useHourlySalesPattern.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';

describe('aggregateHourlySales', () => {
  it('groups sales by hour and averages across weeks', () => {
    const rawSales = [
      { sale_date: '2026-02-24', sale_time: '11:30:00', total_price: 50 },
      { sale_date: '2026-02-24', sale_time: '11:45:00', total_price: 30 },
      { sale_date: '2026-03-03', sale_time: '11:15:00', total_price: 40 },
      { sale_date: '2026-02-24', sale_time: '12:00:00', total_price: 100 },
      { sale_date: '2026-03-03', sale_time: '12:30:00', total_price: 120 },
    ];
    const result = aggregateHourlySales(rawSales);
    // Hour 11: week1=80, week2=40 → avg=60, count=2
    expect(result.find(h => h.hour === 11)?.avgSales).toBe(60);
    expect(result.find(h => h.hour === 11)?.sampleCount).toBe(2);
    // Hour 12: week1=100, week2=120 → avg=110, count=2
    expect(result.find(h => h.hour === 12)?.avgSales).toBe(110);
  });

  it('returns empty array for no sales', () => {
    expect(aggregateHourlySales([])).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/useHourlySalesPattern.test.ts`
Expected: FAIL

**Step 3: Write the hook**

```typescript
// src/hooks/useHourlySalesPattern.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { HourlySalesData } from '@/types/scheduling';

interface RawSale {
  sale_date: string;
  sale_time: string;
  total_price: number;
}

/**
 * Pure function: aggregate raw sales into hourly averages.
 * Groups by hour, sums per week (sale_date), then averages across weeks.
 */
export function aggregateHourlySales(rawSales: RawSale[]): HourlySalesData[] {
  if (rawSales.length === 0) return [];

  // Group by hour → by date → sum
  const hourDateMap = new Map<number, Map<string, number>>();

  for (const sale of rawSales) {
    if (!sale.sale_time) continue;
    const hour = parseInt(sale.sale_time.split(':')[0], 10);
    if (isNaN(hour)) continue;

    if (!hourDateMap.has(hour)) hourDateMap.set(hour, new Map());
    const dateMap = hourDateMap.get(hour)!;
    dateMap.set(sale.sale_date, (dateMap.get(sale.sale_date) ?? 0) + Number(sale.total_price));
  }

  const result: HourlySalesData[] = [];
  for (const [hour, dateMap] of hourDateMap) {
    const dailyTotals = Array.from(dateMap.values());
    const avgSales = dailyTotals.reduce((sum, v) => sum + v, 0) / dailyTotals.length;
    result.push({ hour, avgSales: Math.round(avgSales * 100) / 100, sampleCount: dailyTotals.length });
  }

  return result.sort((a, b) => a.hour - b.hour);
}

/**
 * Fetches unified_sales for a specific day-of-week over the last N weeks,
 * then aggregates into hourly averages.
 */
export function useHourlySalesPattern(
  restaurantId: string | null,
  dayOfWeek: number, // 0=Sun, 6=Sat
  lookbackWeeks: number = 4,
) {
  return useQuery({
    queryKey: ['hourly-sales-pattern', restaurantId, dayOfWeek, lookbackWeeks],
    queryFn: async (): Promise<HourlySalesData[]> => {
      if (!restaurantId) return [];

      // Calculate date range for lookback
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - lookbackWeeks * 7);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Fetch sales for this restaurant in the date range
      // Filter to matching day-of-week client-side (Supabase doesn't support EXTRACT on queries)
      const { data, error } = await supabase
        .from('unified_sales')
        .select('sale_date, sale_time, total_price')
        .eq('restaurant_id', restaurantId)
        .eq('item_type', 'sale')
        .gte('sale_date', startStr)
        .lte('sale_date', endStr)
        .not('sale_time', 'is', null)
        .order('sale_date');

      if (error) throw error;
      if (!data) return [];

      // Filter to matching day-of-week
      const filtered = data.filter((sale) => {
        const d = new Date(sale.sale_date + 'T12:00:00'); // noon to avoid timezone issues
        return d.getDay() === dayOfWeek;
      });

      return aggregateHourlySales(filtered);
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/useHourlySalesPattern.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/useHourlySalesPattern.ts tests/unit/useHourlySalesPattern.test.ts
git commit -m "feat: add useHourlySalesPattern hook with aggregation"
```

---

### Task 6: useStaffingSuggestions Hook

**Files:**
- Create: `src/hooks/useStaffingSuggestions.ts`
- Test: `tests/unit/useStaffingSuggestions.test.ts`

**Step 1: Write the test for the pure orchestration function**

```typescript
// tests/unit/useStaffingSuggestions.test.ts
import { describe, it, expect } from 'vitest';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';

describe('computeStaffingSuggestions', () => {
  it('produces shift blocks from hourly sales and settings', () => {
    const hourlySales = [
      { hour: 11, avgSales: 200, sampleCount: 4 },
      { hour: 12, avgSales: 300, sampleCount: 4 },
      { hour: 13, avgSales: 250, sampleCount: 4 },
      { hour: 14, avgSales: 150, sampleCount: 4 },
    ];
    const result = computeStaffingSuggestions(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      targetLaborPct: 22,
      avgHourlyRateCents: 1500,
      day: '2026-03-10',
    });

    expect(result.recommendations.length).toBe(4);
    expect(result.shiftBlocks.length).toBeGreaterThan(0);
    expect(result.totalRecommendedHours).toBeGreaterThan(0);
    expect(result.peakStaff).toBe(5); // 300/60=5
  });

  it('returns empty results for no sales data', () => {
    const result = computeStaffingSuggestions([], {
      targetSplh: 60,
      minStaff: 1,
      targetLaborPct: 22,
      avgHourlyRateCents: 1500,
      day: '2026-03-10',
    });
    expect(result.recommendations).toEqual([]);
    expect(result.shiftBlocks).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/useStaffingSuggestions.test.ts`
Expected: FAIL

**Step 3: Write the hook**

```typescript
// src/hooks/useStaffingSuggestions.ts
import { useMemo } from 'react';
import { useHourlySalesPattern } from './useHourlySalesPattern';
import { useStaffingSettings } from './useStaffingSettings';
import { useEmployees } from './useEmployees';
import {
  buildHourlyRecommendations,
  consolidateIntoShiftBlocks,
} from '@/lib/staffingCalculator';
import type {
  HourlySalesData,
  HourlyStaffingRecommendation,
  ShiftBlock,
} from '@/types/scheduling';

export interface StaffingSuggestionsResult {
  recommendations: HourlyStaffingRecommendation[];
  shiftBlocks: ShiftBlock[];
  totalRecommendedHours: number;
  peakStaff: number;
  totalProjectedSales: number;
  totalEstimatedLaborCost: number;
  overallLaborPct: number;
}

/**
 * Pure function: compute staffing suggestions from hourly sales data and params.
 * Exported for testing.
 */
export function computeStaffingSuggestions(
  hourlySales: HourlySalesData[],
  params: {
    targetSplh: number;
    minStaff: number;
    targetLaborPct: number;
    avgHourlyRateCents: number;
    day: string;
  },
): StaffingSuggestionsResult {
  if (hourlySales.length === 0) {
    return {
      recommendations: [],
      shiftBlocks: [],
      totalRecommendedHours: 0,
      peakStaff: 0,
      totalProjectedSales: 0,
      totalEstimatedLaborCost: 0,
      overallLaborPct: 0,
    };
  }

  const recommendations = buildHourlyRecommendations(hourlySales, params);
  const shiftBlocks = consolidateIntoShiftBlocks(recommendations, params.day);

  const totalRecommendedHours = recommendations.reduce(
    (sum, r) => sum + r.recommendedStaff,
    0,
  );
  const peakStaff = Math.max(...recommendations.map((r) => r.recommendedStaff));
  const totalProjectedSales = recommendations.reduce((sum, r) => sum + r.projectedSales, 0);
  const totalEstimatedLaborCost = recommendations.reduce(
    (sum, r) => sum + r.estimatedLaborCost,
    0,
  );
  const overallLaborPct =
    totalProjectedSales > 0 ? (totalEstimatedLaborCost / totalProjectedSales) * 100 : 0;

  return {
    recommendations,
    shiftBlocks,
    totalRecommendedHours,
    peakStaff,
    totalProjectedSales,
    totalEstimatedLaborCost,
    overallLaborPct,
  };
}

/**
 * Hook: fetches hourly sales pattern + staffing settings, computes suggestions for a given day.
 */
export function useStaffingSuggestions(restaurantId: string | null, day: string) {
  const dayOfWeek = new Date(day + 'T12:00:00').getDay();
  const { effectiveSettings, isLoading: settingsLoading } = useStaffingSettings(restaurantId);
  const { data: hourlySales, isLoading: salesLoading } = useHourlySalesPattern(
    restaurantId,
    dayOfWeek,
    effectiveSettings.lookback_weeks,
  );
  const { employees } = useEmployees(restaurantId);

  const avgHourlyRateCents = useMemo(() => {
    if (!employees?.length) return 1500; // $15/hr default
    const hourlyEmployees = employees.filter(
      (e) => e.compensation_type === 'hourly' && e.is_active,
    );
    if (hourlyEmployees.length === 0) return 1500;
    return Math.round(
      hourlyEmployees.reduce((sum, e) => sum + e.hourly_rate, 0) / hourlyEmployees.length,
    );
  }, [employees]);

  const suggestions = useMemo(
    () =>
      computeStaffingSuggestions(hourlySales ?? [], {
        targetSplh: effectiveSettings.target_splh,
        minStaff: effectiveSettings.min_staff,
        targetLaborPct: effectiveSettings.target_labor_pct,
        avgHourlyRateCents,
        day,
      }),
    [hourlySales, effectiveSettings, avgHourlyRateCents, day],
  );

  return {
    ...suggestions,
    isLoading: settingsLoading || salesLoading,
    hasSalesData: (hourlySales?.length ?? 0) > 0,
    effectiveSettings,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/useStaffingSuggestions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/useStaffingSuggestions.ts tests/unit/useStaffingSuggestions.test.ts
git commit -m "feat: add useStaffingSuggestions hook with shift block consolidation"
```

---

### Task 7: StaffingOverlay Component

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`
- Create: `src/components/scheduling/ShiftPlanner/StaffingDayColumn.tsx`
- Create: `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx`

**Step 1: Build StaffingDayColumn (hourly visualization)**

This renders the hourly bar chart for a single day column. Uses simple CSS bars, not Recharts — keeps it lightweight and aligned with the grid.

```typescript
// src/components/scheduling/ShiftPlanner/StaffingDayColumn.tsx
// Renders hourly staffing recommendation bars for one day
// - Soft blue bars proportional to headcount
// - Yellow bars when over labor % target
// - Per-day "Apply" button at bottom
```

Reference: Apple/Notion design system from CLAUDE.md — text-[13px], rounded-lg, bg-muted/30, border-border/40.

**Step 2: Build StaffingConfigPanel (inline parameter overrides)**

```typescript
// src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx
// Compact row of inputs: SPLH, Avg Ticket, Labor %, Min Staff
// Changes update effectiveSettings immediately for preview
// "Save as Default" persists to staffing_settings table
```

Reference: Form elements from CLAUDE.md — text-[12px] uppercase labels, h-10 inputs, bg-muted/30.

**Step 3: Build StaffingOverlay (main container)**

```typescript
// src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
// Collapsible panel above template grid
// - Collapsed: "Staffing Suggestions" banner with expand button
// - Expanded: 7 StaffingDayColumns + StaffingConfigPanel + Apply buttons
// - Uses useStaffingSuggestions for each day in weekDays
// - "Apply to Week" creates unassigned shifts via existing useCreateShift
```

The "Apply" flow:
1. For each ShiftBlock, call `validateAndCreate` from useShiftPlanner (no employee_id = unassigned)
2. Show confirmation dialog first: "Create X unassigned shifts for [date range]?"
3. After creation, shifts appear in template grid as unassigned chips

**Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx \
       src/components/scheduling/ShiftPlanner/StaffingDayColumn.tsx \
       src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx
git commit -m "feat: add staffing overlay components"
```

---

### Task 8: Integrate Overlay into ShiftPlannerTab

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

**Step 1: Import and render StaffingOverlay**

Add `<StaffingOverlay>` between `<PlannerHeader>` and `<TemplateGrid>` in the ShiftPlannerTab JSX.

Pass props:
- `restaurantId`
- `weekDays` (from useShiftPlanner)
- `onApply` callback that calls `validateAndCreate` for each shift block

**Step 2: Update exports in index.ts if needed**

Check `src/components/scheduling/ShiftPlanner/index.ts` — it likely only exports `ShiftPlannerTab`, no changes needed.

**Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat: integrate staffing overlay into shift planner"
```

---

### Task 9: Labor Planning Settings Tab

**Files:**
- Modify: `src/pages/RestaurantSettings.tsx`

**Step 1: Add "Labor Planning" tab**

Add a new tab alongside existing General/Business Info/Overtime Rules tabs. Renders a form with:
- Target SPLH ($) — number input
- Average ticket size ($) — number input
- Target labor % — number input
- Minimum staff per hour — number input
- Historical lookback (weeks) — select dropdown: 2, 4, 8, 12
- Save button calling `useStaffingSettings.updateSettings()`

When no POS data is connected, show info message with link to POS integration page.

Follow existing patterns in RestaurantSettings.tsx for tab structure, form layout, and save flow.

**Step 2: Commit**

```bash
git add src/pages/RestaurantSettings.tsx
git commit -m "feat: add Labor Planning tab to restaurant settings"
```

---

### Task 10: Manual Projections Fallback

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`

**Step 1: Add manual fallback UI**

When `hasSalesData` is false, the overlay shows:
- "No sales history available" message
- 7 number inputs (one per day of week) for expected daily revenue
- "Save Projections" button → saves to `staffing_settings.manual_projections`
- When manual projections exist, distribute daily revenue across hours using a default curve (flat distribution or bell curve peaking at lunch/dinner)

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
git commit -m "feat: add manual sales projection fallback"
```

---

## Dependency Graph

```
Task 1 (DB migration) ─┐
Task 2 (Types)         ─┤
                        ├─ Task 3 (Calculator) ─┐
                        │                        ├─ Task 5 (Hourly Sales Hook) ─┐
                        ├─ Task 4 (Settings Hook)┤                              │
                        │                        ├─ Task 6 (Suggestions Hook) ──┤
                        │                                                       │
                        │                        ┌──────────────────────────────┘
                        │                        │
                        ├─ Task 7 (UI Components)┤
                        │                        │
                        ├─ Task 8 (Integration)──┘
                        │
                        ├─ Task 9 (Settings Tab) — independent
                        │
                        └─ Task 10 (Manual Fallback) — after Task 7
```

**Parallelizable:** Tasks 1+2 together, Tasks 3+4 together, Task 9 independent of 7+8.
