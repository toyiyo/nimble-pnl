-- Web Push subscription storage for browser push notifications
CREATE TABLE web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_push_subscriptions_user_endpoint_key UNIQUE (user_id, endpoint)
);

-- Index for lookup by user + restaurant (used by send-web-push edge function)
CREATE INDEX idx_web_push_subscriptions_user_restaurant
  ON web_push_subscriptions (user_id, restaurant_id);

-- RLS: users manage their own subscriptions
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON web_push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
