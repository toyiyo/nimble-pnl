-- Add stripe_customer_id column to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS stripe_customer_id text;