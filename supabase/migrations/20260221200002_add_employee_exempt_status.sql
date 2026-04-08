-- Add FLSA exempt status to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exempt_changed_by UUID REFERENCES auth.users(id);

-- Auto-populate audit columns when is_exempt changes
CREATE OR REPLACE FUNCTION update_exempt_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_exempt IS DISTINCT FROM NEW.is_exempt THEN
    NEW.exempt_changed_at = NOW();
    NEW.exempt_changed_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_exempt_audit_trigger ON employees;
CREATE TRIGGER update_exempt_audit_trigger
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_exempt_audit();

-- Comment for documentation
COMMENT ON COLUMN employees.is_exempt IS 'FLSA exempt status — exempt employees are excluded from overtime calculations';
COMMENT ON COLUMN employees.exempt_changed_at IS 'When exempt status was last changed';
COMMENT ON COLUMN employees.exempt_changed_by IS 'User who last changed exempt status';
