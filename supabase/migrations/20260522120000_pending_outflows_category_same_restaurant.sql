-- Same-restaurant integrity guard for pending_outflows.category_id.
--
-- The existing FK only enforces that category_id points at SOME chart_of_accounts
-- row. The SELECT RLS on chart_of_accounts hides foreign rows from the UI, but a
-- direct API write supplying a foreign uuid would still pass FK validation.
-- This trigger closes that gap by asserting category and outflow share a
-- restaurant_id at write time.

CREATE OR REPLACE FUNCTION public.assert_pending_outflow_category_same_restaurant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    PERFORM 1
      FROM public.chart_of_accounts
     WHERE id = NEW.category_id
       AND restaurant_id = NEW.restaurant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'pending_outflows.category_id % does not belong to restaurant %',
        NEW.category_id, NEW.restaurant_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pending_outflows_category_same_restaurant
BEFORE INSERT OR UPDATE OF category_id, restaurant_id ON public.pending_outflows
FOR EACH ROW
EXECUTE FUNCTION public.assert_pending_outflow_category_same_restaurant();

COMMENT ON FUNCTION public.assert_pending_outflow_category_same_restaurant() IS
  'Asserts pending_outflows.category_id and restaurant_id refer to the same restaurant. Raises ERRCODE 23503 on mismatch.';
