-- Create receipt imports table
CREATE TABLE public.receipt_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  vendor_name TEXT,
  raw_file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  processed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending',
  total_amount NUMERIC,
  raw_ocr_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_by UUID
);

-- Create receipt line items table
CREATE TABLE public.receipt_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id UUID NOT NULL REFERENCES public.receipt_imports(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  parsed_name TEXT,
  parsed_quantity NUMERIC,
  parsed_unit TEXT,
  parsed_price NUMERIC,
  matched_product_id UUID REFERENCES public.products(id),
  confidence_score NUMERIC,
  mapping_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.receipt_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_line_items ENABLE ROW LEVEL SECURITY;