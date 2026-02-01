import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ChatMessage, AiChatMessageDB } from '@/types/ai-chat';

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

  // Save a single message
  const saveMessageMutation = useMutation({
    mutationFn: async (
      message: Omit<ChatMessage, 'id'> & { session_id: string }
    ): Promise<AiChatMessageDB> => {
      const { data, error } = await supabase
        .from('ai_chat_messages')
        .insert({
          session_id: message.session_id,
          role: message.role as string,
          content: message.content,
          name: message.name || null,
          tool_call_id: message.tool_call_id || null,
          tool_calls: (message.tool_calls as unknown) || null,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as AiChatMessageDB;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat-messages', sessionId] });
      // Also invalidate sessions to update the preview text
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
  });

  // Save multiple messages (batch)
  const saveMessagesBatchMutation = useMutation({
    mutationFn: async (
      messages: Array<Omit<ChatMessage, 'id'> & { session_id: string }>
    ): Promise<void> => {
      if (messages.length === 0) return;

      const { error } = await supabase.from('ai_chat_messages').insert(
        messages.map((msg) => ({
          session_id: msg.session_id,
          role: msg.role as string,
          content: msg.content,
          name: msg.name || null,
          tool_call_id: msg.tool_call_id || null,
          tool_calls: (msg.tool_calls as unknown) || null,
        })) as any
      );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat-messages', sessionId] });
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
