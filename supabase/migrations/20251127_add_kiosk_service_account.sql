-- Allow kiosk-specific service accounts and enable them to write time punches without granting manager access elsewhere

-- Extend role check to include kiosk
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;
ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN ('owner', 'manager', 'chef', 'staff', 'kiosk'));

-- Dedicated record of the kiosk service account per restaurant (one per location)
CREATE TABLE IF NOT EXISTS public.kiosk_service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id)
);

ALTER TABLE public.kiosk_service_accounts ENABLE ROW LEVEL SECURITY;

-- Only owners/managers can view or write kiosk service account records
CREATE POLICY kiosk_service_accounts_select ON public.kiosk_service_accounts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = kiosk_service_accounts.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY kiosk_service_accounts_insert ON public.kiosk_service_accounts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = kiosk_service_accounts.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY kiosk_service_accounts_update ON public.kiosk_service_accounts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = kiosk_service_accounts.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY kiosk_service_accounts_delete ON public.kiosk_service_accounts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = kiosk_service_accounts.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- Allow kiosk role to write punches while keeping read/write for managers
DROP POLICY IF EXISTS "Managers can create time punches for employees" ON public.time_punches;
CREATE POLICY "Managers can create time punches for employees" ON public.time_punches
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE public.user_restaurants.restaurant_id = time_punches.restaurant_id
        AND public.user_restaurants.user_id = auth.uid()
        AND public.user_restaurants.role IN ('owner', 'manager', 'kiosk')
    )
  );

-- Allow kiosk role to update PIN usage metadata (last_used_at) without creating/deleting PINs
CREATE POLICY employee_pins_usage_updates ON public.employee_pins
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = employee_pins.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role = 'kiosk'
    )
  );
