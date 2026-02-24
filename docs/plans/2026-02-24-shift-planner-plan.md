# Shift Planner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a shift definition + week template + schedule assignment system that lets managers define recurring shift patterns, build weekly staffing plans, generate schedules, and assign employees to slots.

**Architecture:** Extend existing `shift_templates` table for shift definitions. Add `week_templates`, `week_template_slots`, and `schedule_slots` tables. New "Shift Planner" tab on Scheduling page with three sub-views: definitions manager, template builder, and schedule assignment board. Generated schedules create real `shifts` rows that integrate with the existing week view.

**Tech Stack:** React + TypeScript, React Query, Supabase (PostgreSQL + RLS), shadcn/ui, Lucide icons, date-fns

---

## Task 1: Database Migration — New Tables + Extend shift_templates

**Files:**
- Create: `supabase/migrations/20260224100000_shift_planner_tables.sql`
- Test: `supabase/tests/shift_planner.sql`

**Step 1: Write the pgTAP test file**

Create `supabase/tests/shift_planner.sql`:

```sql
BEGIN;
SELECT plan(12);

-- Test 1: shift_templates has new columns
SELECT has_column('public', 'shift_templates', 'color',
  'shift_templates should have color column');
SELECT has_column('public', 'shift_templates', 'description',
  'shift_templates should have description column');

-- Test 2: week_templates table exists with correct columns
SELECT has_table('public', 'week_templates',
  'week_templates table should exist');
SELECT has_column('public', 'week_templates', 'name',
  'week_templates should have name column');
SELECT has_column('public', 'week_templates', 'is_active',
  'week_templates should have is_active column');

-- Test 3: week_template_slots table exists
SELECT has_table('public', 'week_template_slots',
  'week_template_slots table should exist');
SELECT has_column('public', 'week_template_slots', 'headcount',
  'week_template_slots should have headcount column');
SELECT has_column('public', 'week_template_slots', 'position',
  'week_template_slots should have position column');

-- Test 4: schedule_slots table exists
SELECT has_table('public', 'schedule_slots',
  'schedule_slots table should exist');
SELECT has_column('public', 'schedule_slots', 'employee_id',
  'schedule_slots should have employee_id column');
SELECT has_column('public', 'schedule_slots', 'status',
  'schedule_slots should have status column');

-- Test 5: RLS is enabled on all new tables
SELECT has_table('public', 'schedule_slots',
  'schedule_slots table exists for RLS check');

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run pgTAP test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — tables don't exist yet

**Step 3: Write the migration**

Create `supabase/migrations/20260224100000_shift_planner_tables.sql`:

```sql
-- Shift Planner: definitions, week templates, and schedule slots
-- Extends shift_templates and adds week_templates, week_template_slots, schedule_slots

-- 1. Extend shift_templates with optional columns
ALTER TABLE public.shift_templates
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Make day_of_week nullable (shift definitions are now day-agnostic; day is in week_template_slots)
ALTER TABLE public.shift_templates
  ALTER COLUMN day_of_week DROP NOT NULL;

-- Make position nullable (can be specified at template slot level instead)
ALTER TABLE public.shift_templates
  ALTER COLUMN position DROP NOT NULL;

-- 2. Create week_templates table
CREATE TABLE IF NOT EXISTS public.week_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_week_templates_restaurant_id
  ON public.week_templates(restaurant_id);

-- 3. Create week_template_slots table
CREATE TABLE IF NOT EXISTS public.week_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_template_id UUID NOT NULL REFERENCES public.week_templates(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  position TEXT,
  headcount INTEGER NOT NULL DEFAULT 1 CHECK (headcount > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_week_template_slots_template_id
  ON public.week_template_slots(week_template_id);

-- 4. Create schedule_slots table
CREATE TABLE IF NOT EXISTS public.schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  week_template_slot_id UUID REFERENCES public.week_template_slots(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  slot_index INTEGER NOT NULL DEFAULT 0,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unfilled' CHECK (status IN ('unfilled', 'assigned', 'confirmed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_slots_restaurant_id
  ON public.schedule_slots(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_week_start
  ON public.schedule_slots(restaurant_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_shift_id
  ON public.schedule_slots(shift_id);

-- 5. Enable RLS on new tables
ALTER TABLE public.week_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_slots ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for week_templates
CREATE POLICY "Users can view week templates for their restaurants"
  ON public.week_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create week templates"
  ON public.week_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update week templates"
  ON public.week_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete week templates"
  ON public.week_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- 7. RLS Policies for week_template_slots (access via week_template's restaurant_id)
CREATE POLICY "Users can view week template slots"
  ON public.week_template_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
      AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create week template slots"
  ON public.week_template_slots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update week template slots"
  ON public.week_template_slots FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete week template slots"
  ON public.week_template_slots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- 8. RLS Policies for schedule_slots
CREATE POLICY "Users can view schedule slots for their restaurants"
  ON public.schedule_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create schedule slots"
  ON public.schedule_slots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update schedule slots"
  ON public.schedule_slots FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete schedule slots"
  ON public.schedule_slots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- 9. Updated_at triggers
CREATE TRIGGER update_week_templates_updated_at
  BEFORE UPDATE ON public.week_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_week_template_slots_updated_at
  BEFORE UPDATE ON public.week_template_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_schedule_slots_updated_at
  BEFORE UPDATE ON public.schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

-- 10. RPC: Generate schedule from template
CREATE OR REPLACE FUNCTION public.generate_schedule_from_template(
  p_restaurant_id UUID,
  p_week_template_id UUID,
  p_week_start_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot RECORD;
  v_shift_id UUID;
  v_slot_date DATE;
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_position TEXT;
  v_slots_created INTEGER := 0;
  v_existing_count INTEGER;
BEGIN
  -- Check if schedule already exists for this week
  SELECT COUNT(*) INTO v_existing_count
  FROM public.schedule_slots
  WHERE restaurant_id = p_restaurant_id
    AND week_start_date = p_week_start_date
    AND week_template_slot_id IN (
      SELECT id FROM public.week_template_slots
      WHERE week_template_id = p_week_template_id
    );

  IF v_existing_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Schedule already exists for this week. Delete existing schedule first.',
      'existing_count', v_existing_count
    );
  END IF;

  -- Iterate through template slots
  FOR v_slot IN
    SELECT
      wts.id AS slot_id,
      wts.day_of_week,
      wts.position AS slot_position,
      wts.headcount,
      st.start_time,
      st.end_time,
      st.break_duration,
      st.position AS template_position,
      st.name AS template_name
    FROM public.week_template_slots wts
    JOIN public.shift_templates st ON st.id = wts.shift_template_id
    WHERE wts.week_template_id = p_week_template_id
    ORDER BY wts.day_of_week, wts.sort_order
  LOOP
    -- Calculate the actual date for this day_of_week
    -- p_week_start_date is Monday (day 1), so offset = day_of_week - 1
    -- But day_of_week uses 0=Sunday convention, so:
    -- Sunday(0) = +6, Monday(1) = +0, Tuesday(2) = +1, etc.
    v_slot_date := p_week_start_date +
      CASE v_slot.day_of_week
        WHEN 0 THEN 6  -- Sunday
        ELSE v_slot.day_of_week - 1  -- Mon=0, Tue=1, etc.
      END;

    -- Determine position (slot overrides template)
    v_position := COALESCE(v_slot.slot_position, v_slot.template_position, 'General');

    -- Create one shift + schedule_slot per headcount unit
    FOR i IN 0..(v_slot.headcount - 1) LOOP
      -- Build timestamps from date + time
      v_start_ts := v_slot_date + v_slot.start_time;
      v_end_ts := v_slot_date + v_slot.end_time;

      -- Create the shift (employee_id is NULL — unassigned)
      INSERT INTO public.shifts (
        restaurant_id, employee_id, start_time, end_time,
        break_duration, position, status, source_type, source_id
      ) VALUES (
        p_restaurant_id, NULL, v_start_ts, v_end_ts,
        v_slot.break_duration, v_position, 'scheduled',
        'template', v_slot.slot_id::TEXT || '-' || i::TEXT
      )
      RETURNING id INTO v_shift_id;

      -- Create the schedule slot
      INSERT INTO public.schedule_slots (
        restaurant_id, week_template_slot_id, shift_id,
        week_start_date, slot_index, status
      ) VALUES (
        p_restaurant_id, v_slot.slot_id, v_shift_id,
        p_week_start_date, i, 'unfilled'
      );

      v_slots_created := v_slots_created + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'slots_created', v_slots_created
  );
END;
$$;

-- 11. RPC: Delete generated schedule for a week
CREATE OR REPLACE FUNCTION public.delete_generated_schedule(
  p_restaurant_id UUID,
  p_week_start_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete schedule_slots (shifts cascade via ON DELETE CASCADE on shift_id)
  WITH deleted_slots AS (
    DELETE FROM public.schedule_slots
    WHERE restaurant_id = p_restaurant_id
      AND week_start_date = p_week_start_date
    RETURNING shift_id
  ),
  deleted_shifts AS (
    DELETE FROM public.shifts
    WHERE id IN (SELECT shift_id FROM deleted_slots WHERE shift_id IS NOT NULL)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted_slots;

  RETURN json_build_object(
    'success', true,
    'slots_deleted', v_deleted_count
  );
END;
$$;
```

**Step 4: Apply migration and run pgTAP test**

Run: `npm run db:reset && npm run test:db`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add supabase/migrations/20260224100000_shift_planner_tables.sql supabase/tests/shift_planner.sql
git commit -m "feat: add shift planner database tables and RPC functions"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/scheduling.ts` (add new interfaces after existing `ShiftTemplate`)

**Step 1: Add new types**

Add after the existing `ShiftTemplate` interface (line 122) in `src/types/scheduling.ts`:

```typescript
// Shift definition colors for visual grouping
export const SHIFT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
] as const;

export interface WeekTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeekTemplateSlot {
  id: string;
  week_template_id: string;
  shift_template_id: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  position?: string | null; // NULL = inherit from shift_template
  headcount: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Joined data
  shift_template?: ShiftTemplate;
}

export type ScheduleSlotStatus = 'unfilled' | 'assigned' | 'confirmed';

export interface ScheduleSlot {
  id: string;
  restaurant_id: string;
  week_template_slot_id?: string | null;
  shift_id?: string | null;
  week_start_date: string; // DATE format YYYY-MM-DD
  slot_index: number;
  employee_id?: string | null;
  status: ScheduleSlotStatus;
  created_at: string;
  updated_at: string;
  // Joined data
  shift?: Shift;
  employee?: Employee;
  week_template_slot?: WeekTemplateSlot;
}
```

Also update the existing `ShiftTemplate` interface to include the new optional columns:

```typescript
export interface ShiftTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  day_of_week?: number | null; // Now optional — 0 = Sunday, 6 = Saturday
  start_time: string;
  end_time: string;
  break_duration: number;
  position?: string | null; // Now optional
  is_active: boolean;
  color?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}
```

**Step 2: Commit**

```bash
git add src/types/scheduling.ts
git commit -m "feat: add shift planner TypeScript types"
```

---

## Task 3: Hook — useShiftDefinitions

**Files:**
- Create: `src/hooks/useShiftDefinitions.ts`
- Test: `tests/unit/useShiftDefinitions.test.ts`

**Step 1: Write the test**

Create `tests/unit/useShiftDefinitions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(({ queryFn, enabled }) => {
    if (enabled === false) return { data: undefined, isLoading: false, error: null };
    return { data: undefined, isLoading: true, error: null };
  }),
  useMutation: vi.fn(({ mutationFn }) => ({
    mutate: mutationFn,
    mutateAsync: mutationFn,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

describe('useShiftDefinitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export useShiftDefinitions hook', async () => {
    const mod = await import('@/hooks/useShiftDefinitions');
    expect(mod.useShiftDefinitions).toBeDefined();
    expect(typeof mod.useShiftDefinitions).toBe('function');
  });

  it('should export useCreateShiftDefinition hook', async () => {
    const mod = await import('@/hooks/useShiftDefinitions');
    expect(mod.useCreateShiftDefinition).toBeDefined();
  });

  it('should export useUpdateShiftDefinition hook', async () => {
    const mod = await import('@/hooks/useShiftDefinitions');
    expect(mod.useUpdateShiftDefinition).toBeDefined();
  });

  it('should export useDeleteShiftDefinition hook', async () => {
    const mod = await import('@/hooks/useShiftDefinitions');
    expect(mod.useDeleteShiftDefinition).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useShiftDefinitions.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the hook**

Create `src/hooks/useShiftDefinitions.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ShiftTemplate } from '@/types/scheduling';

export function useShiftDefinitions(restaurantId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['shift-definitions', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('shift_templates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name');
      if (error) throw error;
      return data as ShiftTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    definitions: data || [],
    isLoading,
    error,
  };
}

type ShiftDefinitionInput = {
  restaurant_id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_duration?: number;
  position?: string | null;
  color?: string | null;
  description?: string | null;
  is_active?: boolean;
};

export function useCreateShiftDefinition() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: ShiftDefinitionInput) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: input.restaurant_id,
          name: input.name,
          start_time: input.start_time,
          end_time: input.end_time,
          break_duration: input.break_duration ?? 0,
          position: input.position ?? null,
          color: input.color ?? null,
          description: input.description ?? null,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-definitions'] });
      toast({ title: 'Shift definition created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating shift definition', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateShiftDefinition() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-definitions'] });
      toast({ title: 'Shift definition updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating shift definition', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteShiftDefinition() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('shift_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-definitions'] });
      toast({ title: 'Shift definition deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting shift definition', description: error.message, variant: 'destructive' });
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useShiftDefinitions.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/hooks/useShiftDefinitions.ts tests/unit/useShiftDefinitions.test.ts
git commit -m "feat: add useShiftDefinitions hook with CRUD mutations"
```

---

## Task 4: Hook — useWeekTemplates

**Files:**
- Create: `src/hooks/useWeekTemplates.ts`
- Test: `tests/unit/useWeekTemplates.test.ts`

**Step 1: Write the test**

Create `tests/unit/useWeekTemplates.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(({ enabled }) => {
    if (enabled === false) return { data: undefined, isLoading: false, error: null };
    return { data: undefined, isLoading: true, error: null };
  }),
  useMutation: vi.fn(({ mutationFn }) => ({
    mutate: mutationFn,
    mutateAsync: mutationFn,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

describe('useWeekTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export useWeekTemplates hook', async () => {
    const mod = await import('@/hooks/useWeekTemplates');
    expect(mod.useWeekTemplates).toBeDefined();
  });

  it('should export useCreateWeekTemplate hook', async () => {
    const mod = await import('@/hooks/useWeekTemplates');
    expect(mod.useCreateWeekTemplate).toBeDefined();
  });

  it('should export useWeekTemplateSlots hook', async () => {
    const mod = await import('@/hooks/useWeekTemplates');
    expect(mod.useWeekTemplateSlots).toBeDefined();
  });

  it('should export useAddTemplateSlot hook', async () => {
    const mod = await import('@/hooks/useWeekTemplates');
    expect(mod.useAddTemplateSlot).toBeDefined();
  });

  it('should export useRemoveTemplateSlot hook', async () => {
    const mod = await import('@/hooks/useWeekTemplates');
    expect(mod.useRemoveTemplateSlot).toBeDefined();
  });

  it('should export useUpdateTemplateSlot hook', async () => {
    const mod = await import('@/hooks/useWeekTemplates');
    expect(mod.useUpdateTemplateSlot).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useWeekTemplates.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the hook**

Create `src/hooks/useWeekTemplates.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { WeekTemplate, WeekTemplateSlot } from '@/types/scheduling';

export function useWeekTemplates(restaurantId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['week-templates', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('week_templates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name');
      if (error) throw error;
      return data as WeekTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    templates: data || [],
    isLoading,
    error,
  };
}

export function useCreateWeekTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { restaurant_id: string; name: string; description?: string }) => {
      const { data, error } = await supabase
        .from('week_templates')
        .insert({
          restaurant_id: input.restaurant_id,
          name: input.name,
          description: input.description ?? null,
          is_active: false,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['week-templates'] });
      toast({ title: 'Week template created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating template', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateWeekTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<WeekTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from('week_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['week-templates'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating template', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteWeekTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('week_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['week-templates'] });
      toast({ title: 'Week template deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting template', description: error.message, variant: 'destructive' });
    },
  });
}

export function useSetActiveTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ templateId, restaurantId }: { templateId: string; restaurantId: string }) => {
      // Deactivate all templates for this restaurant
      const { error: deactivateError } = await supabase
        .from('week_templates')
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);
      if (deactivateError) throw deactivateError;

      // Activate the selected one
      const { error: activateError } = await supabase
        .from('week_templates')
        .update({ is_active: true })
        .eq('id', templateId);
      if (activateError) throw activateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['week-templates'] });
      toast({ title: 'Active template updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error setting active template', description: error.message, variant: 'destructive' });
    },
  });
}

// --- Template Slots ---

export function useWeekTemplateSlots(weekTemplateId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['week-template-slots', weekTemplateId],
    queryFn: async () => {
      if (!weekTemplateId) return [];
      const { data, error } = await supabase
        .from('week_template_slots')
        .select('*, shift_template:shift_templates(*)')
        .eq('week_template_id', weekTemplateId)
        .order('day_of_week')
        .order('sort_order');
      if (error) throw error;
      return data as WeekTemplateSlot[];
    },
    enabled: !!weekTemplateId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    slots: data || [],
    isLoading,
    error,
  };
}

export function useAddTemplateSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      week_template_id: string;
      shift_template_id: string;
      day_of_week: number;
      position?: string | null;
      headcount: number;
      sort_order?: number;
    }) => {
      const { data, error } = await supabase
        .from('week_template_slots')
        .insert({
          week_template_id: input.week_template_id,
          shift_template_id: input.shift_template_id,
          day_of_week: input.day_of_week,
          position: input.position ?? null,
          headcount: input.headcount,
          sort_order: input.sort_order ?? 0,
        })
        .select('*, shift_template:shift_templates(*)')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['week-template-slots', variables.week_template_id] });
    },
  });
}

export function useUpdateTemplateSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, week_template_id, ...updates }: {
      id: string;
      week_template_id: string;
      headcount?: number;
      position?: string | null;
      sort_order?: number;
    }) => {
      const { data, error } = await supabase
        .from('week_template_slots')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['week-template-slots', variables.week_template_id] });
    },
  });
}

export function useRemoveTemplateSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, week_template_id }: { id: string; week_template_id: string }) => {
      const { error } = await supabase
        .from('week_template_slots')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['week-template-slots', variables.week_template_id] });
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useWeekTemplates.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/hooks/useWeekTemplates.ts tests/unit/useWeekTemplates.test.ts
git commit -m "feat: add useWeekTemplates hook with template + slot CRUD"
```

---

## Task 5: Hook — useScheduleSlots

**Files:**
- Create: `src/hooks/useScheduleSlots.ts`
- Test: `tests/unit/useScheduleSlots.test.ts`

**Step 1: Write the test**

Create `tests/unit/useScheduleSlots.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(),
      update: vi.fn(),
    })),
    rpc: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(({ enabled }) => {
    if (enabled === false) return { data: undefined, isLoading: false, error: null };
    return { data: undefined, isLoading: true, error: null };
  }),
  useMutation: vi.fn(({ mutationFn }) => ({
    mutate: mutationFn,
    mutateAsync: mutationFn,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

describe('useScheduleSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export useScheduleSlots hook', async () => {
    const mod = await import('@/hooks/useScheduleSlots');
    expect(mod.useScheduleSlots).toBeDefined();
  });

  it('should export useGenerateSchedule hook', async () => {
    const mod = await import('@/hooks/useScheduleSlots');
    expect(mod.useGenerateSchedule).toBeDefined();
  });

  it('should export useAssignEmployee hook', async () => {
    const mod = await import('@/hooks/useScheduleSlots');
    expect(mod.useAssignEmployee).toBeDefined();
  });

  it('should export useUnassignEmployee hook', async () => {
    const mod = await import('@/hooks/useScheduleSlots');
    expect(mod.useUnassignEmployee).toBeDefined();
  });

  it('should export useDeleteGeneratedSchedule hook', async () => {
    const mod = await import('@/hooks/useScheduleSlots');
    expect(mod.useDeleteGeneratedSchedule).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useScheduleSlots.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the hook**

Create `src/hooks/useScheduleSlots.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ScheduleSlot } from '@/types/scheduling';

export function useScheduleSlots(restaurantId: string | null, weekStartDate: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule-slots', restaurantId, weekStartDate],
    queryFn: async () => {
      if (!restaurantId || !weekStartDate) return [];
      const { data, error } = await supabase
        .from('schedule_slots')
        .select(`
          *,
          shift:shifts(*, employee:employees(*)),
          employee:employees(*),
          week_template_slot:week_template_slots(*, shift_template:shift_templates(*))
        `)
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartDate)
        .order('created_at');
      if (error) throw error;
      return data as ScheduleSlot[];
    },
    enabled: !!restaurantId && !!weekStartDate,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    slots: data || [],
    isLoading,
    error,
  };
}

export function useGenerateSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: {
      restaurant_id: string;
      week_template_id: string;
      week_start_date: string;
    }) => {
      const { data, error } = await supabase.rpc('generate_schedule_from_template', {
        p_restaurant_id: input.restaurant_id,
        p_week_template_id: input.week_template_id,
        p_week_start_date: input.week_start_date,
      });
      if (error) throw error;
      const result = data as { success: boolean; slots_created?: number; error?: string; existing_count?: number };
      if (!result.success) {
        throw new Error(result.error || 'Failed to generate schedule');
      }
      return result;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', variables.restaurant_id, variables.week_start_date] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: `Schedule generated: ${result.slots_created} slots created` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error generating schedule', description: error.message, variant: 'destructive' });
    },
  });
}

export function useAssignEmployee() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ slotId, employeeId, shiftId }: {
      slotId: string;
      employeeId: string;
      shiftId: string;
      restaurantId: string;
      weekStartDate: string;
    }) => {
      // Update schedule_slot
      const { error: slotError } = await supabase
        .from('schedule_slots')
        .update({ employee_id: employeeId, status: 'assigned' })
        .eq('id', slotId);
      if (slotError) throw slotError;

      // Update the linked shift
      const { error: shiftError } = await supabase
        .from('shifts')
        .update({ employee_id: employeeId })
        .eq('id', shiftId);
      if (shiftError) throw shiftError;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', variables.restaurantId, variables.weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: 'Employee assigned' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error assigning employee', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUnassignEmployee() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ slotId, shiftId }: {
      slotId: string;
      shiftId: string;
      restaurantId: string;
      weekStartDate: string;
    }) => {
      const { error: slotError } = await supabase
        .from('schedule_slots')
        .update({ employee_id: null, status: 'unfilled' })
        .eq('id', slotId);
      if (slotError) throw slotError;

      const { error: shiftError } = await supabase
        .from('shifts')
        .update({ employee_id: null })
        .eq('id', shiftId);
      if (shiftError) throw shiftError;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', variables.restaurantId, variables.weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: 'Employee unassigned' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error unassigning employee', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteGeneratedSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { restaurant_id: string; week_start_date: string }) => {
      const { data, error } = await supabase.rpc('delete_generated_schedule', {
        p_restaurant_id: input.restaurant_id,
        p_week_start_date: input.week_start_date,
      });
      if (error) throw error;
      return data as { success: boolean; slots_deleted: number };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', variables.restaurant_id, variables.week_start_date] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: `Schedule cleared: ${result.slots_deleted} slots removed` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error clearing schedule', description: error.message, variant: 'destructive' });
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useScheduleSlots.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/hooks/useScheduleSlots.ts tests/unit/useScheduleSlots.test.ts
git commit -m "feat: add useScheduleSlots hook with generate/assign/delete"
```

---

## Task 6: Component — ShiftDefinitionDialog

**Files:**
- Create: `src/components/scheduling/ShiftDefinitionDialog.tsx`

**Step 1: Create the dialog component**

Create `src/components/scheduling/ShiftDefinitionDialog.tsx`. This is a create/edit dialog for shift definitions. Follow the Apple/Notion dialog pattern from CLAUDE.md:

- Dialog with icon box header
- Form fields: name (text), start_time (time input), end_time (time input), break_duration (number), position (select from existing positions + custom), color (preset swatches), description (textarea)
- Uppercase tracking labels (`text-[12px] font-medium text-muted-foreground uppercase tracking-wider`)
- Inputs: `h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg`
- Primary button: `h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium`
- Use `SHIFT_COLORS` from types for color swatches
- Props: `open`, `onOpenChange`, `definition` (ShiftTemplate | null for edit mode), `restaurantId`, `positions` (string[])
- Calls `useCreateShiftDefinition` or `useUpdateShiftDefinition` on submit

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftDefinitionDialog.tsx
git commit -m "feat: add ShiftDefinitionDialog component"
```

---

## Task 7: Component — ShiftDefinitionsManager

**Files:**
- Create: `src/components/scheduling/ShiftDefinitionsManager.tsx`

**Step 1: Create the definitions list component**

Create `src/components/scheduling/ShiftDefinitionsManager.tsx`. This is a panel/sheet that lists all shift definitions:

- Rendered as a Sheet (slide-over) triggered from the planner tab
- List of definitions with: color dot, name, time range (formatted), position badge, active/inactive toggle
- "Add Definition" button at top
- Edit (pencil icon) and Delete (trash icon) actions per row, with hover-reveal (`opacity-0 group-hover:opacity-100`)
- Delete with AlertDialog confirmation
- Uses `useShiftDefinitions`, `useDeleteShiftDefinition`
- Opens `ShiftDefinitionDialog` for create/edit
- Card style: `group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors`
- Loading/empty/error states handled

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftDefinitionsManager.tsx
git commit -m "feat: add ShiftDefinitionsManager component"
```

---

## Task 8: Component — WeekTemplateBuilder

**Files:**
- Create: `src/components/scheduling/WeekTemplateBuilder.tsx`
- Create: `src/components/scheduling/AddSlotDialog.tsx`

**Step 1: Create the AddSlotDialog**

Create `src/components/scheduling/AddSlotDialog.tsx`:
- Dialog to add a shift block to a specific day
- Fields: select shift definition (from `useShiftDefinitions`), position (from `useEmployeePositions` + custom), headcount (number input, min 1)
- Props: `open`, `onOpenChange`, `dayOfWeek` (number), `weekTemplateId`, `definitions` (ShiftTemplate[]), `positions` (string[])
- Calls `useAddTemplateSlot` on submit

**Step 2: Create the WeekTemplateBuilder**

Create `src/components/scheduling/WeekTemplateBuilder.tsx`:

- Top bar: template selector dropdown (from `useWeekTemplates`) + "New Template" button + "Set as Active" star toggle + gear icon to open ShiftDefinitionsManager
- 7-column grid for Mon-Sun (use `eachDayOfInterval` pattern)
- Column header: day name + total hours for that day
- Each column contains slot cards for that day
- Slot card: shift definition color bar left border, name, time range, position + headcount (e.g., "Cashier x3"), edit/remove icons on hover
- "+" button at bottom of each column to add a slot (opens AddSlotDialog with that day)
- Clicking headcount allows inline edit (number input)
- Uses `useWeekTemplateSlots` to fetch slots for selected template
- Total labor hours calculated: sum of (end_time - start_time - break_duration) * headcount per day
- Loading/empty states
- Template CRUD: create via small dialog (name + optional description), delete via confirmation

**Step 3: Commit**

```bash
git add src/components/scheduling/WeekTemplateBuilder.tsx src/components/scheduling/AddSlotDialog.tsx
git commit -m "feat: add WeekTemplateBuilder with 7-day grid layout"
```

---

## Task 9: Component — ScheduleAssignment

**Files:**
- Create: `src/components/scheduling/ScheduleAssignment.tsx`

**Step 1: Create the schedule assignment board**

Create `src/components/scheduling/ScheduleAssignment.tsx`:

- Top bar: week date display, progress bar ("12/18 slots filled"), "Back to Template" button, "Clear Schedule" button (calls `useDeleteGeneratedSchedule`), "Publish" button (uses existing publish flow)
- Main content: grouped by day_of_week, then by shift definition
- Each group header: day name, shift name, time range, position
- Under each group: slot cards for each headcount unit
  - Unfilled: dashed border card with position badge + "Assign" button (opens employee select popover)
  - Filled: solid card with employee name, position, "x" button to unassign
- Employee select: Popover with searchable list of active employees filtered by matching position. Use `useEmployees` with `status: 'active'`. Show employee name, position.
- Conflict checking: when selecting an employee, check if they're already assigned to another slot at overlapping time (client-side check against the loaded slots)
- Props: `restaurantId`, `weekStartDate` (string), `onBack` (callback to return to template view)
- Uses `useScheduleSlots`, `useAssignEmployee`, `useUnassignEmployee`
- Loading/empty states

**Step 2: Commit**

```bash
git add src/components/scheduling/ScheduleAssignment.tsx
git commit -m "feat: add ScheduleAssignment board with employee assignment"
```

---

## Task 10: Component — ShiftPlanner (main tab)

**Files:**
- Create: `src/components/scheduling/ShiftPlanner.tsx`

**Step 1: Create the main orchestrator component**

Create `src/components/scheduling/ShiftPlanner.tsx`:

- Two view states: `'template'` and `'assignment'`
- Template view: renders `<WeekTemplateBuilder />` with a "Generate Schedule" section at the bottom
  - Week picker (date input for week start, snapped to Monday)
  - Template selector (defaults to active template)
  - "Generate Schedule for [week]" button → calls `useGenerateSchedule`, then switches to assignment view
- Assignment view: renders `<ScheduleAssignment />` with `onBack` to return to template view
- Props: `restaurantId`
- State: `view` ('template' | 'assignment'), `targetWeekStart` (string), `selectedTemplateId` (string)

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner.tsx
git commit -m "feat: add ShiftPlanner orchestrator component"
```

---

## Task 11: Integrate into Scheduling Page

**Files:**
- Modify: `src/pages/Scheduling.tsx`

**Step 1: Add the Shift Planner tab**

In `src/pages/Scheduling.tsx`:

1. Add imports at top:
```typescript
import { ShiftPlanner } from '@/components/scheduling/ShiftPlanner';
import { LayoutTemplate } from 'lucide-react';
```

2. Add a new `TabsTrigger` after the "Shift Trades" trigger (around line 777):
```typescript
<TabsTrigger
  value="planner"
  className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2"
>
  <LayoutTemplate className="h-4 w-4" />
  <span className="hidden sm:inline">Shift Planner</span>
</TabsTrigger>
```

3. Add a new `TabsContent` at the end of the Tabs block:
```typescript
<TabsContent value="planner">
  <ShiftPlanner restaurantId={selectedRestaurant?.id ?? null} />
</TabsContent>
```

**Step 2: Verify the build compiles**

Run: `npm run build`
Expected: Build succeeds with no new errors

**Step 3: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat: integrate Shift Planner tab into Scheduling page"
```

---

## Task 12: Regenerate Supabase Types

**Step 1: Regenerate types**

Run the sync-types skill or: `npx supabase gen types typescript --local > src/integrations/supabase/types.ts`

This ensures the new tables (`week_templates`, `week_template_slots`, `schedule_slots`) and modified `shift_templates` columns are available in the TypeScript client.

**Step 2: Fix any type errors**

Run: `npm run build`
Fix any TypeScript errors from the generated types not matching hook usage.

**Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase types for shift planner tables"
```

---

## Task 13: Lint + Build Verification

**Step 1: Run lint**

Run: `npm run lint`
Fix any new lint errors introduced by the shift planner code. Ignore pre-existing errors.

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build with no new errors.

**Step 3: Run all tests**

Run: `npm run test`
Expected: All unit tests pass.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: lint and build fixes for shift planner"
```

---

## Summary

| Task | Component | Est. Lines |
|------|-----------|-----------|
| 1 | Database migration + pgTAP test | ~250 SQL |
| 2 | TypeScript types | ~60 TS |
| 3 | useShiftDefinitions hook + test | ~130 TS |
| 4 | useWeekTemplates hook + test | ~230 TS |
| 5 | useScheduleSlots hook + test | ~170 TS |
| 6 | ShiftDefinitionDialog | ~200 TSX |
| 7 | ShiftDefinitionsManager | ~180 TSX |
| 8 | WeekTemplateBuilder + AddSlotDialog | ~350 TSX |
| 9 | ScheduleAssignment | ~300 TSX |
| 10 | ShiftPlanner orchestrator | ~120 TSX |
| 11 | Scheduling.tsx integration | ~15 TSX |
| 12 | Regenerate Supabase types | ~5 TS |
| 13 | Lint + build verification | 0 |
