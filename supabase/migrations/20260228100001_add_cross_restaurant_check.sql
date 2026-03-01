-- Ensure shift_template belongs to same restaurant as week_template
CREATE OR REPLACE FUNCTION check_slot_restaurant_match()
RETURNS TRIGGER AS $$
DECLARE
  v_template_restaurant_id uuid;
  v_shift_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_template_restaurant_id
  FROM week_templates WHERE id = NEW.week_template_id;

  SELECT restaurant_id INTO v_shift_restaurant_id
  FROM shift_templates WHERE id = NEW.shift_template_id;

  IF v_template_restaurant_id != v_shift_restaurant_id THEN
    RAISE EXCEPTION 'Shift template must belong to the same restaurant as the week template';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_slot_restaurant_match
  BEFORE INSERT OR UPDATE ON week_template_slots
  FOR EACH ROW
  EXECUTE FUNCTION check_slot_restaurant_match();
