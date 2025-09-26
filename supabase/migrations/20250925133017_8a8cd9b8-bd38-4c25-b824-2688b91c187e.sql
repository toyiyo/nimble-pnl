-- Fix the relationship between square_orders and square_order_line_items
-- Add the missing foreign key constraint that should have been created

-- First check if the constraint already exists, if not add it
DO $$ 
BEGIN
    -- Add foreign key constraint for square_order_line_items to reference square_orders
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'square_order_line_items_order_id_restaurant_id_fkey'
        AND table_name = 'square_order_line_items'
    ) THEN
        ALTER TABLE public.square_order_line_items 
        ADD CONSTRAINT square_order_line_items_order_id_restaurant_id_fkey 
        FOREIGN KEY (order_id, restaurant_id) 
        REFERENCES public.square_orders(order_id, restaurant_id);
    END IF;
END $$;

-- Also ensure we have proper indexes for performance
CREATE INDEX IF NOT EXISTS idx_square_orders_order_id_restaurant_id 
ON public.square_orders(order_id, restaurant_id);

CREATE INDEX IF NOT EXISTS idx_square_order_line_items_order_id_restaurant_id 
ON public.square_order_line_items(order_id, restaurant_id);

-- Refresh the schema cache by analyzing the tables
ANALYZE public.square_orders;
ANALYZE public.square_order_line_items;