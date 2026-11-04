import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { ChatMessage, AiChatMessageDB } from '@/types/ai-chat';

type AiChatMessageInsert = Database['public']['Tables']['ai_chat_messages']['Insert'];

/** A client message and the session that the panel saves it into. */
export type ChatMessageToSave = ChatMessage & { session_id: string };

/**
 * The upsert ignores a row whose ID is in the table. A retry of a save is then
 * a no-op, and the client IDs stay equal to the DB IDs.
 */
const UPSERT_OPTIONS = { onConflict: 'id', ignoreDuplicates: true } as const;

/**
 * Copies the tool calls into plain objects. An interface has no index
 * signature, so TypeScript accepts only the plain objects as Json.
 */
function toolCallsJson(toolCalls: ChatMessage['tool_calls']): Json | null {
  return (
    toolCalls?.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })) ?? null
  );
}

/** Maps a client message to a DB row. The client created_at keeps the turn order. */
function toInsertRow(message: ChatMessageToSave): AiChatMessageInsert {
  return {
    id: message.id,
    session_id: message.session_id,
    role: message.role,
    content: message.content,
    name: message.name || null,
    tool_call_id: message.tool_call_id || null,
    tool_calls: toolCallsJson(message.tool_calls),
    ...(message.created_at && { created_at: message.created_at }),
  };
}

/**
 * Hook for managing AI chat messages within a session
 */
export function useAiChatMessages(sessionId?: string) {
  const queryClient = useQueryClient();

  // Fetch messages for a session
  // NOTE: Multi-tenant isolation is enforced via RLS policy chain:
  // - ai_chat_messages_select policy checks session_id IN (SELECT id FROM ai_chat_sessions WHERE user_id = auth.uid())
  // - ai_chat_sessions_select policy checks user_id = auth.uid() AND restaurant_id IN (SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid())
  // This ensures users can only access messages for sessions in restaurants they belong to.
  const {
    data: messages,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ai-chat-messages', sessionId],
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!sessionId) return [];

      const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Transform to ChatMessage format
      return (data || []).map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: msg.content,
        name: msg.name || '',
        tool_call_id: msg.tool_call_id || '',
        tool_calls: ((msg.tool_calls || []) as unknown) as ChatMessage['tool_calls'],
        created_at: msg.created_at,
      }));
    },
    staleTime: 0, // Always fresh for active conversations
    enabled: !!sessionId,
  });

  // Save a single message. The result is null when the row is already saved.
  const saveMessageMutation = useMutation({
    mutationFn: async (message: ChatMessageToSave): Promise<AiChatMessageDB | null> => {
      const { data, error } = await supabase
        .from('ai_chat_messages')
        .upsert(toInsertRow(message), UPSERT_OPTIONS)
        .select()
        .maybeSingle();

      if (error) throw error;
      return data as unknown as AiChatMessageDB | null;
    },
    onSuccess: (_data, message) => {
      // Refresh the session of the saved row. The current session can be another one.
      queryClient.invalidateQueries({ queryKey: ['ai-chat-messages', message.session_id] });
      // Also invalidate sessions to update the preview text
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
  });

  // Save multiple messages (batch)
  const saveMessagesBatchMutation = useMutation({
    mutationFn: async (messages: ChatMessageToSave[]): Promise<void> => {
      if (messages.length === 0) return;

      // One batch otherwise shares one now(), so the load order is lost.
      const { error } = await supabase
        .from('ai_chat_messages')
        .upsert(messages.map(toInsertRow), UPSERT_OPTIONS);

      if (error) throw error;
    },
    onSuccess: (_data, messages) => {
      // Refresh the sessions of the saved rows. The current session can be another one.
      for (const id of new Set(messages.map((m) => m.session_id))) {
        queryClient.invalidateQueries({ queryKey: ['ai-chat-messages', id] });
      }
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
  });

  return {
    messages: messages || [],
    isLoading,
    error,
    refetch,
    saveMessage: saveMessageMutation.mutateAsync,
    saveMessagesBatch: saveMessagesBatchMutation.mutateAsync,
    isSaving: saveMessageMutation.isPending || saveMessagesBatchMutation.isPending,
  };
}
