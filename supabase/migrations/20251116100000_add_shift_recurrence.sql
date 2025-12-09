-- Add recurrence support to shifts table
-- This allows shifts to be created with recurring patterns similar to Google Calendar

-- Add recurrence columns to shifts table
ALTER TABLE shifts 
  ADD COLUMN IF NOT EXISTS recurrence_pattern JSONB,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

-- Add index for querying recurring shifts
CREATE INDEX IF NOT EXISTS idx_shifts_recurrence_parent ON shifts(recurrence_parent_id);
CREATE INDEX IF NOT EXISTS idx_shifts_is_recurring ON shifts(is_recurring);

-- Add comment to document the recurrence_pattern structure
COMMENT ON COLUMN shifts.recurrence_pattern IS 
'JSONB object storing recurrence rules with the following structure:
{
"type": "daily" | "weekly" | "monthly" | "yearly" | "weekday" | "custom",
"interval": number (e.g., 1 for every week, 2 for every 2 weeks),
"daysOfWeek": [0-6] (Sunday=0, Saturday=6, only for weekly/custom),
"dayOfMonth": number (1-31, for monthly),
"weekOfMonth": number (1-5, for monthly "third Sunday" pattern),
"monthOfYear": number (1-12, for yearly),
"endType": "never" | "on" | "after",
"endDate": "ISO date string" (when endType is "on"),
"occurrences": number (when endType is "after")
}';

COMMENT ON COLUMN shifts.recurrence_parent_id IS
'References the first shift in a recurring series. All generated instances reference back to this parent.
NULL for standalone shifts or the parent shift itself.';

COMMENT ON COLUMN shifts.is_recurring IS
'TRUE if this shift is part of a recurring pattern (either parent or child).
Used for quick filtering of recurring vs one-time shifts.';
