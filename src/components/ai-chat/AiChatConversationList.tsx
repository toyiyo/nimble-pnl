import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiChatContext } from '@/contexts/AiChatContext';
import { useAiChatSessions } from '@/hooks/useAiChatSessions';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface AiChatConversationListProps {
  restaurantId: string;
  onNewConversation: () => void;
}

/**
 * List of recent chat conversations (last 20).
 * Allows switching between conversations and creating new ones.
 */
export function AiChatConversationList({
  restaurantId,
  onNewConversation,
}: AiChatConversationListProps) {
  const { currentSessionId, switchSession } = useAiChatContext();
  const { sessions, isLoading, deleteSession } = useAiChatSessions(restaurantId);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-2 border-b">
          <Skeleton className="h-7 w-full" />
        </div>
        <div className="p-1.5 space-y-1">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* New chat button - minimal */}
      <div className="p-2 border-b">
        <Button
          onClick={onNewConversation}
          className="w-full h-7 text-xs"
          variant="ghost"
          size="sm"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New chat
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {sessions.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <MessageSquare className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
              <p>No chats yet</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  'group relative flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors',
                  currentSessionId === session.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/60'
                )}
              >
                <button
                  onClick={() => switchSession(session.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-xs truncate leading-tight">{session.title}</div>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this conversation?')) {
                      deleteSession(session.id);
                    }
                  }}
                  className={cn(
                    'p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0',
                    'hover:bg-destructive/10 hover:text-destructive'
                  )}
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
