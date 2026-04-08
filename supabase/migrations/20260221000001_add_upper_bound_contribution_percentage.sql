-- Add upper bound to contribution_percentage to prevent values > 100%
ALTER TABLE tip_contribution_pools
  DROP CONSTRAINT IF EXISTS tip_contribution_pools_contribution_percentage_check;

ALTER TABLE tip_contribution_pools
  ADD CONSTRAINT tip_contribution_pools_contribution_percentage_check
  CHECK (contribution_percentage > 0 AND contribution_percentage <= 100);
