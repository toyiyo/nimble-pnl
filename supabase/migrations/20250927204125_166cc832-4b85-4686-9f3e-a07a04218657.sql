-- RLS policies for receipt_imports
CREATE POLICY "Users can view receipt imports for their restaurants" 
ON public.receipt_imports 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE restaurant_id = receipt_imports.restaurant_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can create receipt imports for their restaurants" 
ON public.receipt_imports 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE restaurant_id = receipt_imports.restaurant_id 
  AND user_id = auth.uid() 
  AND role IN ('owner', 'manager', 'chef')
));

CREATE POLICY "Users can update receipt imports for their restaurants" 
ON public.receipt_imports 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE restaurant_id = receipt_imports.restaurant_id 
  AND user_id = auth.uid() 
  AND role IN ('owner', 'manager', 'chef')
));

-- RLS policies for receipt_line_items
CREATE POLICY "Users can view receipt line items for their restaurants" 
ON public.receipt_line_items 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM receipt_imports ri 
  JOIN user_restaurants ur ON ri.restaurant_id = ur.restaurant_id
  WHERE ri.id = receipt_line_items.receipt_id 
  AND ur.user_id = auth.uid()
));

CREATE POLICY "Users can manage receipt line items for their restaurants" 
ON public.receipt_line_items 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM receipt_imports ri 
  JOIN user_restaurants ur ON ri.restaurant_id = ur.restaurant_id
  WHERE ri.id = receipt_line_items.receipt_id 
  AND ur.user_id = auth.uid() 
  AND ur.role IN ('owner', 'manager', 'chef')
));

-- Add updated_at triggers
CREATE TRIGGER update_receipt_imports_updated_at
  BEFORE UPDATE ON public.receipt_imports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_receipt_line_items_updated_at
  BEFORE UPDATE ON public.receipt_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();