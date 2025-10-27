import { ChatMessage as ChatMessageType } from '@/types/ai-chat';
import { Bot, User, Wrench, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface ChatMessageProps {
  message: ChatMessageType;
  onNavigate?: (path: string) => void;
}

export const ChatMessage = ({ message, onNavigate }: ChatMessageProps) => {
  const navigate = useNavigate();
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';

  // Don't render tool messages directly (they're internal)
  if (isTool) {
    return null;
  }

  // Check if this is a navigation suggestion by looking for tool calls
  const navigationTool = message.tool_calls?.find(tc => tc.function.name === 'navigate');
  let navigationPath: string | null = null;
  let navigationSection: string | null = null;

  if (navigationTool) {
    try {
      const args = JSON.parse(navigationTool.function.arguments);
      navigationSection = args.section;
      
      // Reconstruct the path from section
      const routes: Record<string, string> = {
        'dashboard': '/',
        'inventory': '/inventory',
        'recipes': '/recipes',
        'pos-sales': '/pos-sales',
        'banking': '/banking',
        'transactions': '/transactions',
        'accounting': '/accounting',
        'financial-statements': '/financial-statements',
        'financial-intelligence': '/financial-intelligence',
        'reports': '/reports',
        'integrations': '/integrations',
        'team': '/team',
        'settings': '/settings',
      };
      
      const basePath = routes[args.section] || '/';
      navigationPath = args.entity_id ? `${basePath}?id=${args.entity_id}` : basePath;
    } catch (e) {
      console.error('Failed to parse navigation tool call:', e);
    }
  }

  const handleNavigate = () => {
    if (navigationPath) {
      if (onNavigate) {
        onNavigate(navigationPath);
      } else {
        navigate(navigationPath);
      }
    }
  };

  return (
    <div
      className={cn(
        'flex gap-3 mb-4',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>
      )}

      <Card
        className={cn(
          'max-w-[80%] px-4 py-3',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="whitespace-pre-wrap m-0">{message.content}</p>
        </div>

        {navigationPath && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <Button
              onClick={handleNavigate}
              size="sm"
              className="w-full"
              variant="default"
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              Go to {navigationSection}
            </Button>
          </div>
        )}

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wrench className="h-3 w-3" />
              <span>
                Using tools: {message.tool_calls.map(tc => {
                  try {
                    return JSON.parse(tc.function.name);
                  } catch {
                    return tc.function.name;
                  }
                }).join(', ')}
              </span>
            </div>
          </div>
        )}
      </Card>

      {isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <User className="h-5 w-5 text-secondary-foreground" />
          </div>
        </div>
      )}
    </div>
  );
};
