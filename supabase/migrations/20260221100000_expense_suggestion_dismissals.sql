-- Table to track dismissed/snoozed/accepted expense suggestions
CREATE TABLE public.expense_suggestion_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  suggestion_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('dismissed', 'snoozed', 'accepted')),
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, suggestion_key)
);

CREATE INDEX idx_expense_suggestion_dismissals_restaurant
  ON public.expense_suggestion_dismissals(restaurant_id);

ALTER TABLE public.expense_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can insert expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can update expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can delete expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

CREATE TRIGGER update_expense_suggestion_dismissals_updated_at
  BEFORE UPDATE ON public.expense_suggestion_dismissals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
