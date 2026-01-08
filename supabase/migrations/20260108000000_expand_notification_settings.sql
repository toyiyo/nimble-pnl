-- Migration: Expand notification settings for employee/manager actions
-- Adds new notification preferences for shift changes, payroll, tips, and employee lifecycle events

-- Add new notification setting columns
ALTER TABLE notification_settings
  -- Shift notifications
  ADD COLUMN IF NOT EXISTS notify_shift_created BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_shift_modified BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_shift_deleted BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_shift_reminder BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS shift_reminder_hours INTEGER DEFAULT 2,
  
  -- Payroll notifications
  ADD COLUMN IF NOT EXISTS notify_payroll_finalized BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_manual_payment BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_compensation_changed BOOLEAN DEFAULT true,
  
  -- Tip notifications
  ADD COLUMN IF NOT EXISTS notify_tip_split_created BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_tip_split_approved BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_tip_dispute_submitted BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_tip_dispute_resolved BOOLEAN DEFAULT true,
  
  -- Production/Inventory notifications
  ADD COLUMN IF NOT EXISTS notify_production_run_completed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_production_variance BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS production_variance_threshold DECIMAL(5,2) DEFAULT 10.0,
  
  -- Invoice notifications
  ADD COLUMN IF NOT EXISTS notify_invoice_created BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_invoice_sent BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_invoice_paid BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_invoice_overdue BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_overdue_days INTEGER DEFAULT 7,
  
  -- Employee lifecycle notifications
  ADD COLUMN IF NOT EXISTS notify_employee_activated BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_employee_deactivated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_employee_reactivated BOOLEAN DEFAULT true,
  
  -- Time tracking notifications
  ADD COLUMN IF NOT EXISTS notify_missed_punch_out BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_timecard_edited BOOLEAN DEFAULT true,
  
  -- Access control notifications
  ADD COLUMN IF NOT EXISTS notify_pin_reset BOOLEAN DEFAULT true;

-- Add comment to describe the table
COMMENT ON TABLE notification_settings IS 'Configurable notification preferences for each restaurant. Controls which events trigger email notifications to employees and managers.';

-- Add comments for new columns
COMMENT ON COLUMN notification_settings.notify_shift_created IS 'Send email when a new shift is assigned to an employee';
COMMENT ON COLUMN notification_settings.notify_shift_modified IS 'Send email when an existing shift is changed';
COMMENT ON COLUMN notification_settings.notify_shift_deleted IS 'Send email when a shift is removed';
COMMENT ON COLUMN notification_settings.notify_shift_reminder IS 'Send reminder emails before shifts start';
COMMENT ON COLUMN notification_settings.shift_reminder_hours IS 'How many hours before shift to send reminder';

COMMENT ON COLUMN notification_settings.notify_payroll_finalized IS 'Send email when payroll period is finalized';
COMMENT ON COLUMN notification_settings.notify_manual_payment IS 'Send email when manual payment is added';
COMMENT ON COLUMN notification_settings.notify_compensation_changed IS 'Send email when employee rate/salary changes';

COMMENT ON COLUMN notification_settings.notify_tip_split_created IS 'Send email when manager creates tip split';
COMMENT ON COLUMN notification_settings.notify_tip_split_approved IS 'Send email when manager approves tip split';
COMMENT ON COLUMN notification_settings.notify_tip_dispute_submitted IS 'Send email to managers when employee submits tip dispute';
COMMENT ON COLUMN notification_settings.notify_tip_dispute_resolved IS 'Send email to employee when manager resolves dispute';

COMMENT ON COLUMN notification_settings.notify_production_run_completed IS 'Send email when prep production run is completed';
COMMENT ON COLUMN notification_settings.notify_production_variance IS 'Send email when production variance exceeds threshold';
COMMENT ON COLUMN notification_settings.production_variance_threshold IS 'Variance percentage threshold (e.g., 10.0 = 10%)';

COMMENT ON COLUMN notification_settings.notify_invoice_created IS 'Send email to customer when invoice is created';
COMMENT ON COLUMN notification_settings.notify_invoice_sent IS 'Send email to customer when invoice is sent';
COMMENT ON COLUMN notification_settings.notify_invoice_paid IS 'Send email to manager when invoice is paid';
COMMENT ON COLUMN notification_settings.notify_invoice_overdue IS 'Send email when invoice is overdue';
COMMENT ON COLUMN notification_settings.invoice_overdue_days IS 'Days after due date to consider invoice overdue';

COMMENT ON COLUMN notification_settings.notify_employee_activated IS 'Send welcome email when employee account is activated';
COMMENT ON COLUMN notification_settings.notify_employee_deactivated IS 'Send email when employee is deactivated';
COMMENT ON COLUMN notification_settings.notify_employee_reactivated IS 'Send email when employee is reactivated';

COMMENT ON COLUMN notification_settings.notify_missed_punch_out IS 'Send email when employee misses punch-out';
COMMENT ON COLUMN notification_settings.notify_timecard_edited IS 'Send email when manager edits timecard';

COMMENT ON COLUMN notification_settings.notify_pin_reset IS 'Send email with new PIN when manager resets it';

-- Create index for frequently queried settings
CREATE INDEX IF NOT EXISTS idx_notification_settings_shift_notifications 
  ON notification_settings(restaurant_id) 
  WHERE notify_shift_created = true 
     OR notify_shift_modified = true 
     OR notify_shift_deleted = true;

CREATE INDEX IF NOT EXISTS idx_notification_settings_tip_notifications 
  ON notification_settings(restaurant_id) 
  WHERE notify_tip_split_approved = true 
     OR notify_tip_dispute_submitted = true;
