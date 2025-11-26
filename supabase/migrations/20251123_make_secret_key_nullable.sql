-- Make secret_key nullable for Lighthouse-only connections
ALTER TABLE public.shift4_connections
  ALTER COLUMN secret_key DROP NOT NULL;
