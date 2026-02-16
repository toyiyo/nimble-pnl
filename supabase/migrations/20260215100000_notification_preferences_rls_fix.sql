-- Fix notification_preferences RLS: verify restaurant membership on INSERT/UPDATE
DROP POLICY IF EXISTS "Users can insert their own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can update their own notification preferences" ON public.notification_preferences;

CREATE POLICY "Users can insert their own notification preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
        AND ur.restaurant_id = notification_preferences.restaurant_id
    )
  );

CREATE POLICY "Users can update their own notification preferences"
  ON public.notification_preferences FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
        AND ur.restaurant_id = notification_preferences.restaurant_id
    )
  );
