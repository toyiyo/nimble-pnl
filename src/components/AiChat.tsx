import { useState, useRef, useEffect } from 'react';
import { useAiChat } from '@/hooks/useAiChat';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { ChatMessage } from '@/components/ChatMessage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, Send, Loader2, XCircle, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export const AiChat = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, error, sendMessage, clearMessages, abortStream } = useAiChat({
    restaurantId: selectedRestaurant?.restaurant_id || '',
    onToolCall: async (toolCall) => {
      // Navigation is now handled via message prompts, not automatic navigation
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const message = input;
    setInput('');
    await sendMessage(message);
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
  };

  if (!selectedRestaurant) {
    return (
      <Card className="bg-gradient-to-br from-muted/50 to-transparent">
        <CardContent className="py-12 text-center">
          <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Restaurant Selected</h3>
          <p className="text-muted-foreground">Please select a restaurant to use the AI assistant.</p>
        </CardContent>
      </Card>
    );
  }

  const quickActions = [
    { label: 'Show KPIs', prompt: 'Show me the key metrics for this month' },
    { label: 'Inventory Status', prompt: 'What is my current inventory status?' },
    { label: 'Low Stock Items', prompt: 'Show me items that are low in stock' },
    { label: 'Recipe Analytics', prompt: 'Which recipes are most profitable?' },
    { label: 'Sales Summary', prompt: 'Summarize sales for this week' },
  ];

  return (
    <div className="flex flex-col h-full max-h-[100dvh] md:max-h-full">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10 mb-4 flex-shrink-0">
        <CardHeader className="py-4 md:py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary to-accent">
                <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-xl md:text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  AI Assistant
                </CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Ask questions about your restaurant operations, get insights, and navigate the app
                </CardDescription>
              </div>
            </div>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearMessages}
                disabled={isStreaming}
                className="hidden md:flex"
              >
                Clear Chat
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Quick Actions */}
      {messages.length === 0 && (
        <Card className="mb-4 flex-shrink-0">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent transition-colors text-xs"
                  onClick={() => handleQuickAction(action.prompt)}
                >
                  {action.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat Messages - Scrollable area */}
      <div className="flex-1 min-h-0 mb-4">
        <ScrollArea className="h-full px-4" ref={scrollAreaRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Bot className="h-12 w-12 md:h-16 md:w-16 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-base md:text-lg font-semibold mb-2">How can I help you today?</h3>
              <p className="text-sm md:text-base text-muted-foreground max-w-md px-4">
                I can help you with inventory, recipes, sales, financial reports, and more.
                Try asking a question or use a quick action above.
              </p>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isStreaming && (
                <div className="flex gap-3 mb-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                      <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />
                    </div>
                  </div>
                  <Card className="max-w-[80%] px-4 py-3 bg-muted">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </Card>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4" />
            <span className="text-xs md:text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Input Area - Fixed at bottom */}
      <Card className="border-t rounded-none flex-shrink-0 sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="p-3 md:p-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={isStreaming}
              className="flex-1 text-sm md:text-base"
              aria-label="Chat message input"
            />
            {isStreaming ? (
              <Button
                type="button"
                onClick={abortStream}
                variant="outline"
                size="icon"
                aria-label="Stop generation"
                className="flex-shrink-0"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!input.trim() || isStreaming}
                size="icon"
                aria-label="Send message"
                className="flex-shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </Card>
    </div>
  );
};
