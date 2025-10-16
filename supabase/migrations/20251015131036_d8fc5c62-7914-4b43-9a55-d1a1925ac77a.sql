-- Add environment field to clover_connections to track sandbox vs production
ALTER TABLE clover_connections 
ADD COLUMN environment text NOT NULL DEFAULT 'production' 
CHECK (environment IN ('sandbox', 'production'));