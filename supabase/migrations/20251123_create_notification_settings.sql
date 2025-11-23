-- Create notification_settings table for configurable notifications
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  
  -- Time-off request notifications
  notify_time_off_request BOOLEAN NOT NULL DEFAULT true,
  notify_time_off_approved BOOLEAN NOT NULL DEFAULT true,
  notify_time_off_rejected BOOLEAN NOT NULL DEFAULT true,
  
  -- Recipients (who should receive notifications)
  time_off_notify_managers BOOLEAN NOT NULL DEFAULT true,
  time_off_notify_employee BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(restaurant_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_notification_settings_restaurant_id ON notification_settings(restaurant_id);

-- Enable Row Level Security
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notification_settings
CREATE POLICY "Users can view notification settings for their restaurants"
  ON notification_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = notification_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage notification settings"
  ON notification_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = notification_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Create trigger for updated_at
CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

-- Add comments for documentation
COMMENT ON TABLE notification_settings IS 'Stores notification preferences for each restaurant';
COMMENT ON COLUMN notification_settings.notify_time_off_request IS 'Send notification when a time-off request is submitted';
COMMENT ON COLUMN notification_settings.notify_time_off_approved IS 'Send notification when a time-off request is approved';
COMMENT ON COLUMN notification_settings.notify_time_off_rejected IS 'Send notification when a time-off request is rejected';
COMMENT ON COLUMN notification_settings.time_off_notify_managers IS 'Send time-off notifications to managers';
COMMENT ON COLUMN notification_settings.time_off_notify_employee IS 'Send time-off notifications to the employee';

-- Insert default settings for existing restaurants
INSERT INTO notification_settings (restaurant_id)
SELECT id FROM restaurants
WHERE id NOT IN (SELECT restaurant_id FROM notification_settings)
ON CONFLICT (restaurant_id) DO NOTHING;
