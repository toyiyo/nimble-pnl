-- Add RLS policies so staff/employees can read tip data for their restaurant.
-- Without these, the usePayroll hook returns $0 tips for staff users because
-- the tip_splits query is blocked by RLS, causing the tip_split_items query
-- to be skipped entirely.

-- Staff can read approved/archived tip_splits for their restaurant
-- (needed by usePayroll to resolve tip split IDs before querying items)
DROP POLICY IF EXISTS "Employees can view approved tip splits" ON tip_splits;
CREATE POLICY "Employees can view approved tip splits"
  ON tip_splits FOR SELECT
  USING (
    status IN ('approved', 'archived')
    AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.restaurant_id = tip_splits.restaurant_id
      AND employees.user_id = auth.uid()
    )
  );

-- Staff can read their own tip_payouts (already existed but verify)
-- This policy already exists from 20260218000000 migration, so just ensure it's there
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'tip_payouts'
    AND policyname = 'Employees can view their own tip payouts'
  ) THEN
    CREATE POLICY "Employees can view their own tip payouts"
      ON tip_payouts FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = tip_payouts.employee_id
          AND employees.user_id = auth.uid()
          AND employees.restaurant_id = tip_payouts.restaurant_id
        )
      );
  END IF;
END $$;
