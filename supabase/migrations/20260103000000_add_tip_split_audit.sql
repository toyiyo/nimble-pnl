-- Migration: Add tip split audit trail
-- Enables tracking of all changes to tip splits (create, reopen, approve, modify)
-- Part of Feature #3: Edit/Reopen Approved Splits

-- 1. Create audit table
CREATE TABLE IF NOT EXISTS tip_split_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'approved', 'reopened', 'modified', 'archived', 'deleted')),
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  changes JSONB, -- { "field": "total_amount", "old": 15000, "new": 15500 }
  reason TEXT
);

-- 2. Index for performance
CREATE INDEX IF NOT EXISTS idx_tip_split_audit_split ON tip_split_audit(tip_split_id);
CREATE INDEX IF NOT EXISTS idx_tip_split_audit_changed_at ON tip_split_audit(changed_at DESC);

-- 3. Enable RLS
ALTER TABLE tip_split_audit ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DROP POLICY IF EXISTS "Managers can view tip split audit" ON tip_split_audit;
CREATE POLICY "Managers can view tip split audit"
  ON tip_split_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_split_audit.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can insert tip split audit" ON tip_split_audit;
CREATE POLICY "Managers can insert tip split audit"
  ON tip_split_audit FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_split_audit.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- 5. Trigger to auto-create audit entries on tip_splits changes
CREATE OR REPLACE FUNCTION log_tip_split_change()
RETURNS TRIGGER AS $$
BEGIN
  -- On INSERT (creation)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO tip_split_audit (tip_split_id, action, changed_by)
    VALUES (NEW.id, 'created', NEW.created_by);
    RETURN NEW;
  END IF;

  -- On UPDATE (approval or status change)
  IF TG_OP = 'UPDATE' THEN
    -- Detect approval
    IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
      INSERT INTO tip_split_audit (tip_split_id, action, changed_by, changes)
      VALUES (
        NEW.id, 
        'approved', 
        NEW.approved_by,
        jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status))
      );
    END IF;

    -- Detect reopen (approved → draft)
    IF OLD.status = 'approved' AND NEW.status = 'draft' THEN
      INSERT INTO tip_split_audit (tip_split_id, action, changed_by, reason)
      VALUES (
        NEW.id, 
        'reopened', 
        auth.uid(),
        'Manager reopened for editing'
      );
    END IF;

    -- Detect amount changes
    IF OLD.total_amount != NEW.total_amount THEN
      INSERT INTO tip_split_audit (tip_split_id, action, changed_by, changes)
      VALUES (
        NEW.id, 
        'modified', 
        auth.uid(),
        jsonb_build_object('total_amount', jsonb_build_object('old', OLD.total_amount, 'new', NEW.total_amount))
      );
    END IF;

    RETURN NEW;
  END IF;

  -- On DELETE
  IF TG_OP = 'DELETE' THEN
    INSERT INTO tip_split_audit (tip_split_id, action, changed_by)
    VALUES (OLD.id, 'deleted', auth.uid());
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Attach trigger to tip_splits
DROP TRIGGER IF EXISTS tip_split_audit_trigger ON tip_splits;
CREATE TRIGGER tip_split_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON tip_splits
  FOR EACH ROW
  EXECUTE FUNCTION log_tip_split_change();

-- 7. Grant access
GRANT SELECT, INSERT ON tip_split_audit TO authenticated;
