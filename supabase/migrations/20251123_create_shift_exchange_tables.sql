-- Create shift exchange system tables
-- This migration adds support for shift trading, open shifts, and manager approval workflows

-- Table for employee shift offers (when an employee wants to give away their shift)
CREATE TABLE IF NOT EXISTS shift_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  offering_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'claimed', 'approved', 'rejected', 'cancelled'
  is_partial BOOLEAN DEFAULT FALSE, -- For partial shift trades
  partial_start_time TIMESTAMP WITH TIME ZONE, -- If partial shift trade
  partial_end_time TIMESTAMP WITH TIME ZONE, -- If partial shift trade
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_partial_times CHECK (
    (is_partial = FALSE) OR 
    (is_partial = TRUE AND partial_start_time IS NOT NULL AND partial_end_time IS NOT NULL AND partial_end_time > partial_start_time)
  )
);

-- Table for shift claims (when an employee wants to take a shift)
CREATE TABLE IF NOT EXISTS shift_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  shift_offer_id UUID REFERENCES shift_offers(id) ON DELETE CASCADE, -- NULL for open shifts
  open_shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE, -- Reference to open shift
  claiming_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  message TEXT, -- Optional message to the manager
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'cancelled'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT claim_has_offer_or_open_shift CHECK (
    (shift_offer_id IS NOT NULL AND open_shift_id IS NULL) OR
    (shift_offer_id IS NULL AND open_shift_id IS NOT NULL)
  )
);

-- Table for manager approvals/rejections
CREATE TABLE IF NOT EXISTS shift_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  shift_claim_id UUID NOT NULL REFERENCES shift_claims(id) ON DELETE CASCADE,
  approved_by UUID NOT NULL REFERENCES auth.users(id),
  decision TEXT NOT NULL, -- 'approved', 'rejected'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for shift exchange notifications
CREATE TABLE IF NOT EXISTS shift_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id), -- For manager notifications
  notification_type TEXT NOT NULL, -- 'offer_created', 'claim_requested', 'claim_approved', 'claim_rejected', 'open_shift_available'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  shift_offer_id UUID REFERENCES shift_offers(id) ON DELETE CASCADE,
  shift_claim_id UUID REFERENCES shift_claims(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_shift_offers_restaurant_id ON shift_offers(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_shift_id ON shift_offers(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_offering_employee_id ON shift_offers(offering_employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_status ON shift_offers(status);

CREATE INDEX IF NOT EXISTS idx_shift_claims_restaurant_id ON shift_claims(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shift_claims_shift_offer_id ON shift_claims(shift_offer_id);
CREATE INDEX IF NOT EXISTS idx_shift_claims_open_shift_id ON shift_claims(open_shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_claims_claiming_employee_id ON shift_claims(claiming_employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_claims_status ON shift_claims(status);

CREATE INDEX IF NOT EXISTS idx_shift_approvals_restaurant_id ON shift_approvals(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shift_approvals_shift_claim_id ON shift_approvals(shift_claim_id);
CREATE INDEX IF NOT EXISTS idx_shift_approvals_approved_by ON shift_approvals(approved_by);

CREATE INDEX IF NOT EXISTS idx_shift_notifications_restaurant_id ON shift_notifications(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shift_notifications_employee_id ON shift_notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_notifications_user_id ON shift_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_shift_notifications_is_read ON shift_notifications(is_read);

-- Add a field to shifts table to mark as open/unassigned
ALTER TABLE shifts 
  ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_shifts_is_open ON shifts(is_open);

-- Add comment to explain open shifts
COMMENT ON COLUMN shifts.is_open IS 
'TRUE if this is an open/unassigned shift that employees can claim. 
When TRUE, employee_id may be NULL or represent a placeholder employee.';

-- Enable Row Level Security
ALTER TABLE shift_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shift_offers table
CREATE POLICY "Users can view shift offers for their restaurants"
  ON shift_offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_offers.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create shift offers for their restaurants"
  ON shift_offers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_offers.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update shift offers for their restaurants"
  ON shift_offers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_offers.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can delete shift offers"
  ON shift_offers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants ur
      WHERE ur.restaurant_id = shift_offers.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- TODO: Add employee-level deletion when user_id is added to employees table
-- Employees should be able to delete their own offers but not others'
-- Current limitation: no direct user_id field on employees table

-- RLS Policies for shift_claims table
CREATE POLICY "Users can view shift claims for their restaurants"
  ON shift_claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_claims.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create shift claims for their restaurants"
  ON shift_claims FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_claims.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update shift claims for their restaurants"
  ON shift_claims FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_claims.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can delete shift claims"
  ON shift_claims FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants ur
      WHERE ur.restaurant_id = shift_claims.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
    )
  );

-- TODO: Add employee-level deletion when user_id is added to employees table
-- Employees should be able to cancel their own claims but not others'
-- Current limitation: no direct user_id field on employees table

-- RLS Policies for shift_approvals table
CREATE POLICY "Users can view shift approvals for their restaurants"
  ON shift_approvals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_approvals.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create shift approvals for their restaurants"
  ON shift_approvals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_approvals.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for shift_notifications table
CREATE POLICY "Users can view their own notifications"
  ON shift_notifications FOR SELECT
  USING (
    (employee_id IN (
      SELECT e.id FROM employees e
      JOIN user_restaurants ur ON ur.restaurant_id = e.restaurant_id
      WHERE ur.user_id = auth.uid()
    ))
    OR
    (user_id = auth.uid())
  );

CREATE POLICY "System can create notifications"
  ON shift_notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_notifications.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own notifications"
  ON shift_notifications FOR UPDATE
  USING (
    (employee_id IN (
      SELECT e.id FROM employees e
      JOIN user_restaurants ur ON ur.restaurant_id = e.restaurant_id
      WHERE ur.user_id = auth.uid()
    ))
    OR
    (user_id = auth.uid())
  );

CREATE POLICY "Users can delete their own notifications"
  ON shift_notifications FOR DELETE
  USING (
    (employee_id IN (
      SELECT e.id FROM employees e
      JOIN user_restaurants ur ON ur.restaurant_id = e.restaurant_id
      WHERE ur.user_id = auth.uid()
    ))
    OR
    (user_id = auth.uid())
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_shift_exchange_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_shift_offers_updated_at
  BEFORE UPDATE ON shift_offers
  FOR EACH ROW
  EXECUTE FUNCTION update_shift_exchange_updated_at();

CREATE TRIGGER update_shift_claims_updated_at
  BEFORE UPDATE ON shift_claims
  FOR EACH ROW
  EXECUTE FUNCTION update_shift_exchange_updated_at();

-- Create function to automatically update shift assignment when claim is approved
CREATE OR REPLACE FUNCTION handle_shift_claim_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_shift_offer_id UUID;
  v_open_shift_id UUID;
  v_claiming_employee_id UUID;
  v_shift_id UUID;
BEGIN
  -- Only process if the decision is 'approved'
  IF NEW.decision = 'approved' THEN
    -- Update the shift claim status
    UPDATE shift_claims
    SET status = 'approved'
    WHERE id = NEW.shift_claim_id;
    
    -- Get the claim details
    SELECT shift_offer_id, open_shift_id, claiming_employee_id
    INTO v_shift_offer_id, v_open_shift_id, v_claiming_employee_id
    FROM shift_claims
    WHERE id = NEW.shift_claim_id;
    
    -- If it's a shift offer claim, update the original shift
    IF v_shift_offer_id IS NOT NULL THEN
      -- Update shift offer status
      UPDATE shift_offers
      SET status = 'approved'
      WHERE id = v_shift_offer_id;
      
      -- Get the shift_id from the offer
      SELECT shift_id INTO v_shift_id
      FROM shift_offers
      WHERE id = v_shift_offer_id;
      
      -- Update the shift to assign to the claiming employee
      UPDATE shifts
      SET employee_id = v_claiming_employee_id
      WHERE id = v_shift_id;
    END IF;
    
    -- If it's an open shift claim, update the open shift
    IF v_open_shift_id IS NOT NULL THEN
      UPDATE shifts
      SET employee_id = v_claiming_employee_id,
          is_open = FALSE
      WHERE id = v_open_shift_id;
    END IF;
  ELSIF NEW.decision = 'rejected' THEN
    -- Update the shift claim status to rejected
    UPDATE shift_claims
    SET status = 'rejected'
    WHERE id = NEW.shift_claim_id;
    
    -- If there's a shift offer, set it back to open
    UPDATE shift_offers so
    SET status = 'open'
    WHERE so.id = (
      SELECT shift_offer_id 
      FROM shift_claims 
      WHERE id = NEW.shift_claim_id 
      AND shift_offer_id IS NOT NULL
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for shift claim approval
CREATE TRIGGER trigger_shift_claim_approval
  AFTER INSERT ON shift_approvals
  FOR EACH ROW
  EXECUTE FUNCTION handle_shift_claim_approval();

-- Create function to create notifications on shift offer
CREATE OR REPLACE FUNCTION notify_shift_offer_created()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify all eligible employees (excluding the offering employee)
  INSERT INTO shift_notifications (
    restaurant_id,
    employee_id,
    notification_type,
    title,
    message,
    shift_offer_id
  )
  SELECT
    NEW.restaurant_id,
    e.id,
    'offer_created',
    'New Shift Available',
    'A shift has been offered for ' || TO_CHAR(s.start_time, 'Mon DD at HH12:MI AM'),
    NEW.id
  FROM employees e
  JOIN shifts s ON s.id = NEW.shift_id
  WHERE e.restaurant_id = NEW.restaurant_id
    AND e.status = 'active'
    AND e.id != NEW.offering_employee_id;
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for shift offer notifications
CREATE TRIGGER trigger_notify_shift_offer_created
  AFTER INSERT ON shift_offers
  FOR EACH ROW
  EXECUTE FUNCTION notify_shift_offer_created();

-- Create function to notify when a shift is claimed
CREATE OR REPLACE FUNCTION notify_shift_claimed()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify managers about the claim request
  INSERT INTO shift_notifications (
    restaurant_id,
    user_id,
    notification_type,
    title,
    message,
    shift_claim_id
  )
  SELECT
    NEW.restaurant_id,
    ur.user_id,
    'claim_requested',
    'Shift Claim Request',
    'An employee has requested to claim a shift',
    NEW.id
  FROM user_restaurants ur
  WHERE ur.restaurant_id = NEW.restaurant_id
    AND ur.role IN ('owner', 'manager');
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for shift claim notifications
CREATE TRIGGER trigger_notify_shift_claimed
  AFTER INSERT ON shift_claims
  FOR EACH ROW
  EXECUTE FUNCTION notify_shift_claimed();
