-- Enable pgTAP extension for database testing
-- pgTAP is a unit testing framework for PostgreSQL

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Comment explaining the testing setup
COMMENT ON EXTENSION pgtap IS 'Unit testing framework for PostgreSQL database functions';
