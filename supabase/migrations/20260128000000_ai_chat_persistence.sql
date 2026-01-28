-- AI Chat Persistence
-- Adds tables for storing chat sessions and messages with conversation history

-- Chat Sessions (Conversations)
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE ai_chat_sessions IS 'AI chat conversation sessions per user/restaurant';
COMMENT ON COLUMN ai_chat_sessions.title IS 'Auto-generated from first user message or user-set';
COMMENT ON COLUMN ai_chat_sessions.is_archived IS 'True when session exceeds 20-session limit per restaurant';

-- Chat Messages
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content text NOT NULL,
  name text,
  tool_call_id text,
  tool_calls jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_chat_messages IS 'Individual messages within AI chat sessions';
COMMENT ON COLUMN ai_chat_messages.name IS 'For tool messages - the tool name';
COMMENT ON COLUMN ai_chat_messages.tool_call_id IS 'For tool result messages - links to tool call';
COMMENT ON COLUMN ai_chat_messages.tool_calls IS 'Array of tool calls made by assistant';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_restaurant_updated
  ON ai_chat_sessions(restaurant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user
  ON ai_chat_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_active
  ON ai_chat_sessions(restaurant_id, user_id, is_archived) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
  ON ai_chat_messages(session_id, created_at ASC);

-- RLS Policies
ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can only access their own sessions for their restaurants
CREATE POLICY ai_chat_sessions_select ON ai_chat_sessions
  FOR SELECT USING (
    user_id = auth.uid()
    AND restaurant_id IN (
      SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY ai_chat_sessions_insert ON ai_chat_sessions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND restaurant_id IN (
      SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY ai_chat_sessions_update ON ai_chat_sessions
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ai_chat_sessions_delete ON ai_chat_sessions
  FOR DELETE USING (user_id = auth.uid());

-- Messages inherit access from sessions
CREATE POLICY ai_chat_messages_select ON ai_chat_messages
  FOR SELECT USING (
    session_id IN (SELECT id FROM ai_chat_sessions WHERE user_id = auth.uid())
  );

CREATE POLICY ai_chat_messages_insert ON ai_chat_messages
  FOR INSERT WITH CHECK (
    session_id IN (SELECT id FROM ai_chat_sessions WHERE user_id = auth.uid())
  );

CREATE POLICY ai_chat_messages_delete ON ai_chat_messages
  FOR DELETE USING (
    session_id IN (SELECT id FROM ai_chat_sessions WHERE user_id = auth.uid())
  );

-- Function to auto-update session timestamp when messages are added
CREATE OR REPLACE FUNCTION update_ai_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ai_chat_sessions
  SET updated_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ai_chat_messages_update_session
  AFTER INSERT ON ai_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_chat_session_timestamp();

-- Function to archive old sessions (keep last 20 per user/restaurant)
CREATE OR REPLACE FUNCTION archive_old_ai_chat_sessions(p_restaurant_id uuid, p_user_id uuid)
RETURNS integer AS $$
DECLARE
  v_archived_count integer;
BEGIN
  WITH ranked_sessions AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY updated_at DESC) as rn
    FROM ai_chat_sessions
    WHERE restaurant_id = p_restaurant_id
      AND user_id = p_user_id
      AND NOT is_archived
  )
  UPDATE ai_chat_sessions
  SET is_archived = true
  WHERE id IN (
    SELECT id FROM ranked_sessions WHERE rn > 20
  );

  GET DIAGNOSTICS v_archived_count = ROW_COUNT;
  RETURN v_archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION archive_old_ai_chat_sessions IS 'Archives sessions beyond the 20-session limit per user/restaurant';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION archive_old_ai_chat_sessions(uuid, uuid) TO authenticated;
