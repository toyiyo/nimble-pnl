-- Fix for CI/Test Environment Compatibility
-- This migration fixes issues that cause failures in test environments:
-- 1. Recreate daily_pnl table without cascading generated columns
-- 2. Make trigger_square_periodic_sync compatible with missing pg_net
-- 3. Skip auth.config updates in test environments

-- Drop and recreate daily_pnl table with fixed generated columns
DROP TABLE IF EXISTS public.daily_pnl CASCADE;

CREATE TABLE public.daily_pnl (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  net_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  food_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  labor_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  gross_profit DECIMAL(10,2) GENERATED ALWAYS AS (net_revenue - food_cost - labor_cost) STORED,
  prime_cost DECIMAL(10,2) GENERATED ALWAYS AS (food_cost + labor_cost) STORED,
  food_cost_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN net_revenue > 0 THEN (food_cost / net_revenue * 100) ELSE 0 END
  ) STORED,
  labor_cost_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN net_revenue > 0 THEN (labor_cost / net_revenue * 100) ELSE 0 END
  ) STORED,
  -- FIX: Calculate prime_cost_percentage directly without referencing prime_cost column
  prime_cost_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN net_revenue > 0 THEN ((food_cost + labor_cost) / net_revenue * 100) ELSE 0 END
  ) STORED,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, date)
);

-- Enable Row Level Security
ALTER TABLE public.daily_pnl ENABLE ROW LEVEL SECURITY;

-- Recreate RLS policies
CREATE POLICY "Users can view P&L for their restaurants"
ON public.daily_pnl FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = daily_pnl.restaurant_id
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert P&L for their restaurants"
ON public.daily_pnl FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = daily_pnl.restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  )
);

CREATE POLICY "Users can update P&L for their restaurants"
ON public.daily_pnl FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = daily_pnl.restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  )
);

-- Add updated_at trigger
CREATE TRIGGER update_daily_pnl_updated_at
BEFORE UPDATE ON public.daily_pnl
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Fix trigger_square_periodic_sync to handle missing pg_net extension
CREATE OR REPLACE FUNCTION public.trigger_square_periodic_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Check if net schema exists (pg_net extension installed)
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    -- Use EXECUTE to avoid syntax errors when net schema doesn't exist
    EXECUTE format(
      'SELECT net.http_post(
        url := %L,
        headers := %L,
        body := %L
      )',
      'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw"}',
      '{"manual": true}'
    );
  ELSE
    -- Log notice if net schema not available (test environment)
    RAISE NOTICE 'pg_net extension not available, skipping HTTP request';
  END IF;
END;
$$;

-- Fix auth.config update to be conditional
DO $$
BEGIN
  -- Only update auth.config if the table exists (production Supabase environment)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'auth' 
    AND table_name = 'config'
  ) THEN
    UPDATE auth.config SET 
      password_leak_protection = TRUE
    WHERE TRUE;
  ELSE
    -- Log notice if auth.config not available (test environment)
    RAISE NOTICE 'auth.config table not available, skipping password leak protection update';
  END IF;
END $$;