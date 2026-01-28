import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AiChatSession, AiChatSessionWithPreview } from '@/types/ai-chat';

/**
 * Hook for managing AI chat sessions (conversations)
 */
export function useAiChatSessions(restaurantId?: string) {
  const queryClient = useQueryClient();

  // Fetch sessions with preview text
  const {
    data: sessions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ai-chat-sessions', restaurantId],
    queryFn: async (): Promise<AiChatSessionWithPreview[]> => {
      if (!restaurantId) return [];

      // Get sessions with first message for preview
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('ai_chat_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (sessionsError) throw sessionsError;
      if (!sessionsData) return [];

      // Get first user message for each session (for preview)
      const sessionsWithPreview: AiChatSessionWithPreview[] = await Promise.all(
        sessionsData.map(async (session) => {
          const { data: firstMessage } = await supabase
            .from('ai_chat_messages')
            .select('content')
            .eq('session_id', session.id)
            .eq('role', 'user')
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

          return {
            ...session,
            preview_text: firstMessage?.content?.slice(0, 60) || 'New conversation',
          };
        })
      );

      return sessionsWithPreview;
    },
    staleTime: 30000, // 30 seconds
    enabled: !!restaurantId,
  });

  // Create a new session
  const createSessionMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      title,
    }: {
      restaurantId: string;
      title?: string;
    }): Promise<AiChatSession> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('ai_chat_sessions')
        .insert({
          restaurant_id: restaurantId,
          user_id: user.id,
          title: title || 'New Conversation',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions', restaurantId] });
    },
  });

  // Update session title
  const updateTitleMutation = useMutation({
    mutationFn: async ({
      sessionId,
      title,
    }: {
      sessionId: string;
      title: string;
    }): Promise<void> => {
      const { error } = await supabase
        .from('ai_chat_sessions')
        .update({ title })
        .eq('id', sessionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions', restaurantId] });
    },
  });

  // Archive a session
  const archiveSessionMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      const { error } = await supabase
        .from('ai_chat_sessions')
        .update({ is_archived: true })
        .eq('id', sessionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions', restaurantId] });
    },
  });

  // Delete a session (permanent)
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      const { error } = await supabase
        .from('ai_chat_sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions', restaurantId] });
    },
  });

  return {
    sessions: sessions || [],
    isLoading,
    error,
    refetch,
    createSession: createSessionMutation.mutateAsync,
    isCreating: createSessionMutation.isPending,
    updateTitle: updateTitleMutation.mutate,
    archiveSession: archiveSessionMutation.mutate,
    deleteSession: deleteSessionMutation.mutate,
  };
}
