-- Add missing account types and subtypes for restaurant CoA
-- First, add the 'cogs' type if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_enum' AND typcategory = 'E') THEN
    CREATE TYPE public.account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense', 'cogs');
  ELSE
    -- Add 'cogs' if it doesn't exist in the enum
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cogs' AND enumtypid = 'public.account_type_enum'::regtype) THEN
      ALTER TYPE public.account_type_enum ADD VALUE 'cogs';
    END IF;
  END IF;
END $$;

-- Add comprehensive subtypes for restaurant accounting
DO $$
BEGIN
  -- Check if the enum exists and add missing values
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_subtype_enum' AND typcategory = 'E') THEN
    -- Asset subtypes
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cash' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'cash';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'accounts_receivable' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'accounts_receivable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'inventory' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'inventory';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'prepaid_expenses' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'prepaid_expenses';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'fixed_assets' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'fixed_assets';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'accumulated_depreciation' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'accumulated_depreciation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'other_assets' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'other_assets';
    END IF;
    
    -- Liability subtypes
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'accounts_payable' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'accounts_payable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'credit_card' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'credit_card';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'loan' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'loan';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'payroll_liabilities' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'payroll_liabilities';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'deferred_revenue' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'deferred_revenue';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'other_liabilities' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'other_liabilities';
    END IF;
    
    -- Equity subtypes
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'owners_equity' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'owners_equity';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'retained_earnings' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'retained_earnings';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'distributions' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'distributions';
    END IF;
    
    -- Revenue subtypes
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'food_sales' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'food_sales';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'beverage_sales' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'beverage_sales';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'alcohol_sales' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'alcohol_sales';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'catering_income' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'catering_income';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'other_income' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'other_income';
    END IF;
    
    -- COGS subtypes
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'food_cost' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'food_cost';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'beverage_cost' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'beverage_cost';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'packaging_cost' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'packaging_cost';
    END IF;
    
    -- Expense subtypes
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'labor' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'labor';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rent' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'rent';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'utilities' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'utilities';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'marketing' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'marketing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'insurance' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'insurance';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'repairs_maintenance' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'repairs_maintenance';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'professional_fees' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'professional_fees';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'other_expenses' AND enumtypid = 'public.account_subtype_enum'::regtype) THEN
      ALTER TYPE public.account_subtype_enum ADD VALUE 'other_expenses';
    END IF;
  END IF;
END $$;

-- Add location_code field to chart_of_accounts to support multi-location tracking
ALTER TABLE public.chart_of_accounts 
ADD COLUMN IF NOT EXISTS location_code text;

-- Add index for location-based queries
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_location 
ON public.chart_of_accounts(restaurant_id, location_code) 
WHERE location_code IS NOT NULL;