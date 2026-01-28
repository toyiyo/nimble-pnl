import { useState, useRef, useEffect, useCallback } from 'react';
import { Minus, X, Sparkles, Bot, Send, Loader2, XCircle, PanelLeftClose, PanelLeft, GripVertical } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useAiChatContext } from '@/contexts/AiChatContext';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAiChat } from '@/hooks/useAiChat';
import { useAiChatSessions } from '@/hooks/useAiChatSessions';
import { useAiChatMessages } from '@/hooks/useAiChatMessages';
import { ChatMessage } from '@/components/ChatMessage';
import { AiChatConversationList } from './AiChatConversationList';
import { cn } from '@/lib/utils';

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;
const STORAGE_KEY = 'ai-chat-panel-width';

/**
 * Main floating AI chat panel.
 * Shows as a Sheet on the right side with conversation list and chat interface.
 */
export function AiChatPanel() {
  const { isOpen, isMinimized, currentSessionId, closeChat, minimizeChat, switchSession, clearCurrentSession } =
    useAiChatContext();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || '';

  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.min(Math.max(parseInt(saved, 10), MIN_WIDTH), MAX_WIDTH) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Session management
  const { createSession, updateTitle } = useAiChatSessions(restaurantId);
  const { messages: dbMessages, saveMessagesBatch } = useAiChatMessages(currentSessionId || undefined);

  // Chat hook
  const { messages, isStreaming, error, sendMessage, clearMessages, abortStream, setMessages } = useAiChat({
    restaurantId,
  });

  // Load messages from database when session changes
  useEffect(() => {
    if (currentSessionId && dbMessages.length > 0) {
      setMessages(dbMessages);
    } else if (!currentSessionId) {
      clearMessages();
    }
  }, [currentSessionId, dbMessages, setMessages, clearMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save messages after streaming completes
  useEffect(() => {
    const saveMessages = async () => {
      if (!isStreaming && currentSessionId && messages.length > 0) {
        // Find messages not yet in database
        const newMessages = messages.filter(
          (msg) => !dbMessages.some((dbMsg) => dbMsg.id === msg.id)
        );

        if (newMessages.length > 0) {
          try {
            await saveMessagesBatch(
              newMessages.map((msg) => ({
                ...msg,
                session_id: currentSessionId,
              }))
            );

            // Auto-generate title from first user message
            const firstUserMsg = messages.find((m) => m.role === 'user');
            if (messages.length <= 3 && firstUserMsg) {
              const title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
              updateTitle({ sessionId: currentSessionId, title });
            }
          } catch (err) {
            console.error('Failed to save messages:', err);
          }
        }
      }
    };

    saveMessages();
  }, [isStreaming, currentSessionId, messages, dbMessages, saveMessagesBatch, updateTitle]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.min(Math.max(newWidth, MIN_WIDTH), MAX_WIDTH);
      setPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(STORAGE_KEY, panelWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, panelWidth]);

  const handleNewConversation = useCallback(async () => {
    if (!restaurantId) return;

    try {
      const session = await createSession({ restaurantId });
      switchSession(session.id);
      clearMessages();
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [restaurantId, createSession, switchSession, clearMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    // Create session if needed
    if (!currentSessionId && restaurantId) {
      try {
        const session = await createSession({ restaurantId });
        switchSession(session.id);
      } catch (err) {
        console.error('Failed to create session:', err);
        return;
      }
    }

    const message = input;
    setInput('');
    await sendMessage(message);
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
  };

  // Don't render if closed or minimized
  if (!isOpen || isMinimized) return null;

  const quickActions = [
    { label: 'Show KPIs', prompt: 'Show me the key metrics for this month' },
    { label: 'Inventory Status', prompt: 'What is my current inventory status?' },
    { label: 'Recipe Analytics', prompt: 'Which recipes are most profitable?' },
    { label: 'Sales Summary', prompt: 'Summarize sales for this week' },
  ];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeChat()} modal={false}>
      <SheetContent
        side="right"
        className={cn(
          'p-0 border-l shadow-2xl bg-background/98 backdrop-blur-sm',
          'supports-[backdrop-filter]:bg-background/95',
          'flex flex-col'
        )}
        style={{ width: `${panelWidth}px`, maxWidth: '100vw' }}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => minimizeChat()}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-50',
            'hover:bg-primary/20 active:bg-primary/30 transition-colors',
            'group flex items-center justify-center',
            isResizing && 'bg-primary/30'
          )}
        >
          <div className="absolute left-0 w-4 h-full" /> {/* Larger hit area */}
          <GripVertical className="h-4 w-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity -ml-1.5" />
        </div>
        {/* Header - Clean minimal design */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowSidebar(!showSidebar)}
              aria-label={showSidebar ? 'Hide conversations' : 'Show conversations'}
            >
              {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
            <div className="p-1.5 rounded-md bg-gradient-to-br from-violet-500 to-purple-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <SheetTitle className="text-sm font-medium">Assistant</SheetTitle>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={minimizeChat}
              aria-label="Minimize chat"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={closeChat}
              aria-label="Close chat"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* No restaurant selected */}
        {!restaurantId ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Restaurant Selected</h3>
              <p className="text-muted-foreground text-sm">
                Please select a restaurant to use the AI assistant.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Sidebar - Conversation List (hidden by default, toggled) */}
            {showSidebar && (
              <div className="w-52 border-r flex-shrink-0 bg-muted/30">
                <AiChatConversationList
                  restaurantId={restaurantId}
                  onNewConversation={handleNewConversation}
                />
              </div>
            )}

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Messages */}
              <ScrollArea className="flex-1 px-3">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-8">
                    <div className="p-2 rounded-full bg-muted/50 mb-3">
                      <Bot className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-medium mb-1">How can I help?</h3>
                    <p className="text-xs text-muted-foreground max-w-[200px] mb-4">
                      Ask about inventory, sales, recipes, or financials.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center max-w-[280px]">
                      {quickActions.map((action, idx) => (
                        <Badge
                          key={idx}
                          variant="outline"
                          className="cursor-pointer hover:bg-accent transition-colors text-[11px] px-2 py-0.5"
                          onClick={() => handleQuickAction(action.prompt)}
                        >
                          {action.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 py-4">
                    {messages.map((message) => (
                      <ChatMessage key={message.id} message={message} />
                    ))}
                    {isStreaming && (
                      <div className="flex gap-2">
                        <div className="flex-shrink-0">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                            <Loader2 className="h-3 w-3 text-white animate-spin" />
                          </div>
                        </div>
                        <Card className="max-w-[85%] px-3 py-2 bg-muted/50 border-0 shadow-none">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>Thinking...</span>
                          </div>
                        </Card>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Error */}
              {error && (
                <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <XCircle className="h-4 w-4" />
                    <span className="text-xs">{error}</span>
                  </div>
                </div>
              )}

              {/* Input - Clean minimal design */}
              <div className="p-2 border-t">
                <form onSubmit={handleSubmit} className="flex gap-1.5">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Message..."
                    disabled={isStreaming}
                    className="flex-1 text-sm h-9 bg-muted/40 border-0 focus-visible:ring-1"
                    aria-label="Chat message input"
                  />
                  {isStreaming ? (
                    <Button
                      type="button"
                      onClick={abortStream}
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      aria-label="Stop generation"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={!input.trim()}
                      size="icon"
                      className="h-9 w-9"
                      aria-label="Send message"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </form>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
