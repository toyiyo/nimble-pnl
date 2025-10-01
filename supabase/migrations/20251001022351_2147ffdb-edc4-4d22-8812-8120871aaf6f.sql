-- Add timezone column to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN timezone TEXT DEFAULT 'America/Chicago';

-- Add comment explaining the column
COMMENT ON COLUMN public.restaurants.timezone IS 'IANA timezone identifier for the restaurant location (e.g., America/Chicago, America/New_York). Defaults to America/Chicago.';

-- Update existing restaurants with timezone from their Square locations if available
UPDATE public.restaurants r
SET timezone = sl.timezone
FROM public.square_locations sl
WHERE r.id = sl.restaurant_id
  AND sl.timezone IS NOT NULL
  AND r.timezone = 'America/Chicago';  -- Only update if still default