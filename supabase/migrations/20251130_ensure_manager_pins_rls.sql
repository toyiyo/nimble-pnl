-- Ensure RLS and appropriate policies for manager_pins
-- This migration is idempotent and can be run repeatedly to ensure RLS
-- and policy state are correct for manager_pins table.

-- Make sure table exists before altering - creation is handled in a separate migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manager_pins'
  ) THEN
    RAISE NOTICE 'Table public.manager_pins does not exist, skipping RLS policy enforcement.';
    RETURN;
  END IF;
END $$;

-- Enable row level security idempotently
ALTER TABLE public.manager_pins ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to recreate cleanly
DROP POLICY IF EXISTS manager_pins_select ON public.manager_pins;
DROP POLICY IF EXISTS manager_pins_insert ON public.manager_pins;
DROP POLICY IF EXISTS manager_pins_update ON public.manager_pins;
DROP POLICY IF EXISTS manager_pins_delete ON public.manager_pins;
DROP POLICY IF EXISTS manager_pins_manage ON public.manager_pins;
DROP POLICY IF EXISTS manager_pins_deny_all ON public.manager_pins;

-- SELECT: allow the manager themselves or restaurant owners/managers to view pins
CREATE POLICY manager_pins_select ON public.manager_pins
  FOR SELECT
  USING (
    auth.uid() = manager_user_id
    OR EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = manager_pins.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- INSERT: allow the manager themselves or owners/managers to insert pins
CREATE POLICY manager_pins_insert ON public.manager_pins
  FOR INSERT
  WITH CHECK (
    auth.uid() = manager_user_id
    OR EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = manager_pins.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- UPDATE: allow the manager themselves or owners/managers to update
CREATE POLICY manager_pins_update ON public.manager_pins
  FOR UPDATE
  USING (
    auth.uid() = manager_user_id
    OR EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = manager_pins.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    auth.uid() = manager_user_id
    OR EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = manager_pins.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- DELETE: allow owners/managers (but not arbitrary managers) to delete a pin
CREATE POLICY manager_pins_delete ON public.manager_pins
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = manager_pins.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- Fallback: Explicit deny for other cases (optional, keeps intent clear)
CREATE POLICY manager_pins_deny_all ON public.manager_pins
  FOR ALL
  USING (false);

-- Ensure the indexes and triggers exist (no-op if already created by original migration)
CREATE UNIQUE INDEX IF NOT EXISTS manager_pins_user_unique ON public.manager_pins (restaurant_id, manager_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS manager_pins_pin_unique ON public.manager_pins (restaurant_id, pin_hash);
CREATE INDEX IF NOT EXISTS manager_pins_last_used_idx ON public.manager_pins (restaurant_id, last_used_at desc nulls last);

-- Maintain an updated_at trigger for the table
CREATE OR REPLACE FUNCTION public.set_manager_pins_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_manager_pins_updated ON public.manager_pins;
CREATE TRIGGER tr_manager_pins_updated
  BEFORE UPDATE ON public.manager_pins
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_manager_pins_updated_at();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
