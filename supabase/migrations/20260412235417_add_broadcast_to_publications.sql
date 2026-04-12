ALTER TABLE schedule_publications
  ADD COLUMN IF NOT EXISTS open_shifts_broadcast_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_shifts_broadcast_by UUID REFERENCES auth.users(id);
