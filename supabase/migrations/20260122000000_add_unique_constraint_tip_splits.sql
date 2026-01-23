-- Migration: Add unique constraint to tip_splits (restaurant_id, split_date)
-- This prevents duplicate splits for the same date

-- Step 1: Clean up existing duplicates by keeping only the most recent split per date
-- Delete tip_split_items for duplicates first (to satisfy FK constraint)
WITH ranked_splits AS (
  SELECT
    id,
    restaurant_id,
    split_date,
    ROW_NUMBER() OVER (
      PARTITION BY restaurant_id, split_date
      ORDER BY
        CASE status
          WHEN 'archived' THEN 1  -- Prefer archived (locked) splits
          WHEN 'approved' THEN 2  -- Then approved
          ELSE 3                   -- Then drafts
        END,
        created_at DESC           -- Most recent first
    ) as rn
  FROM tip_splits
),
duplicates_to_delete AS (
  SELECT id FROM ranked_splits WHERE rn > 1
)
DELETE FROM tip_split_items
WHERE tip_split_id IN (SELECT id FROM duplicates_to_delete);

-- Delete the duplicate tip_splits themselves
WITH ranked_splits AS (
  SELECT
    id,
    restaurant_id,
    split_date,
    ROW_NUMBER() OVER (
      PARTITION BY restaurant_id, split_date
      ORDER BY
        CASE status
          WHEN 'archived' THEN 1
          WHEN 'approved' THEN 2
          ELSE 3
        END,
        created_at DESC
    ) as rn
  FROM tip_splits
)
DELETE FROM tip_splits
WHERE id IN (SELECT id FROM ranked_splits WHERE rn > 1);

-- Step 2: Add unique constraint to prevent future duplicates
ALTER TABLE tip_splits
ADD CONSTRAINT tip_splits_restaurant_date_unique
UNIQUE (restaurant_id, split_date);

-- Add a comment explaining the constraint
COMMENT ON CONSTRAINT tip_splits_restaurant_date_unique ON tip_splits IS
'Ensures only one tip split per restaurant per date. Use update/upsert for modifications.';
