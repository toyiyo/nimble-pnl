-- =============================================================
-- AI Operator: ops_inbox_item, daily_brief, notification_preferences
-- =============================================================

-- 1. ops_inbox_item
CREATE TABLE public.ops_inbox_item (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('uncategorized_txn', 'uncategorized_pos', 'anomaly', 'reconciliation', 'recommendation')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'snoozed', 'done', 'dismissed')),
  snoozed_until TIMESTAMP WITH TIME ZONE,
  due_at TIMESTAMP WITH TIME ZONE,
  linked_entity_type TEXT,
  linked_entity_id UUID,
  evidence_json JSONB DEFAULT '[]'::jsonb,
  meta JSONB DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.ops_inbox_item ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ops_inbox_restaurant_status ON public.ops_inbox_item(restaurant_id, status);
CREATE INDEX idx_ops_inbox_priority ON public.ops_inbox_item(restaurant_id, priority) WHERE status = 'open';
CREATE INDEX idx_ops_inbox_kind ON public.ops_inbox_item(restaurant_id, kind);
CREATE INDEX idx_ops_inbox_snoozed ON public.ops_inbox_item(snoozed_until) WHERE status = 'snoozed';

CREATE POLICY "Users can view inbox items for their restaurants"
  ON public.ops_inbox_item FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Managers and owners can insert inbox items"
  ON public.ops_inbox_item FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager')
  ));

CREATE POLICY "Managers and owners can update inbox items"
  ON public.ops_inbox_item FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager')
  ));

CREATE POLICY "Owners can delete inbox items"
  ON public.ops_inbox_item FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
    AND ur.role = 'owner'
  ));

-- 2. daily_brief
CREATE TABLE public.daily_brief (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  brief_date DATE NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comparisons_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  variances_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  inbox_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative TEXT,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  email_sent_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (restaurant_id, brief_date)
);

ALTER TABLE public.daily_brief ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_daily_brief_lookup ON public.daily_brief(restaurant_id, brief_date DESC);

CREATE POLICY "Users can view briefs for their restaurants"
  ON public.daily_brief FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = daily_brief.restaurant_id
    AND ur.user_id = auth.uid()
  ));

-- Insert/update only via service role (Edge Functions)
-- No INSERT/UPDATE/DELETE policies for regular users

-- 3. notification_preferences
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  daily_brief_email BOOLEAN NOT NULL DEFAULT true,
  brief_send_time TIME NOT NULL DEFAULT '07:00',
  inbox_digest_email BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notification preferences"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences"
  ON public.notification_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
