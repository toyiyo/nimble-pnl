-- Add FLSA exempt status to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exempt_changed_by UUID REFERENCES auth.users(id);

-- Comment for documentation
COMMENT ON COLUMN employees.is_exempt IS 'FLSA exempt status — exempt employees are excluded from overtime calculations';
COMMENT ON COLUMN employees.exempt_changed_at IS 'When exempt status was last changed';
COMMENT ON COLUMN employees.exempt_changed_by IS 'User who last changed exempt status';
