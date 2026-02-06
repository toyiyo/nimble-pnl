-- Fix AI Chat RLS Policies
-- Updates update/delete policies to also check restaurant membership
-- Previously these only checked user_id, which could allow access without restaurant membership

-- Drop existing policies
DROP POLICY IF EXISTS ai_chat_sessions_update ON ai_chat_sessions;
DROP POLICY IF EXISTS ai_chat_sessions_delete ON ai_chat_sessions;
DROP POLICY IF EXISTS ai_chat_messages_delete ON ai_chat_messages;

-- Recreate ai_chat_sessions_update with restaurant membership check
CREATE POLICY ai_chat_sessions_update ON ai_chat_sessions
  FOR UPDATE USING (
    user_id = auth.uid()
    AND restaurant_id IN (
      SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND restaurant_id IN (
      SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()
    )
  );

-- Recreate ai_chat_sessions_delete with restaurant membership check
CREATE POLICY ai_chat_sessions_delete ON ai_chat_sessions
  FOR DELETE USING (
    user_id = auth.uid()
    AND restaurant_id IN (
      SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()
    )
  );

-- Recreate ai_chat_messages_delete with full session/restaurant membership check
CREATE POLICY ai_chat_messages_delete ON ai_chat_messages
  FOR DELETE USING (
    session_id IN (
      SELECT id FROM ai_chat_sessions
      WHERE user_id = auth.uid()
        AND restaurant_id IN (
          SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()
        )
    )
  );

COMMENT ON POLICY ai_chat_sessions_update ON ai_chat_sessions IS 'Users can only update their own sessions in restaurants they belong to';
COMMENT ON POLICY ai_chat_sessions_delete ON ai_chat_sessions IS 'Users can only delete their own sessions in restaurants they belong to';
COMMENT ON POLICY ai_chat_messages_delete ON ai_chat_messages IS 'Users can only delete messages from their own sessions in restaurants they belong to';
