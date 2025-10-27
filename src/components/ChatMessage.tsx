import { ChatMessage as ChatMessageType } from '@/types/ai-chat';
import { Bot, User, Wrench, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface ChatMessageProps {
  message: ChatMessageType;
  onNavigate?: (path: string) => void;
}

// Initialize mermaid
mermaid.initialize({ 
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
});

const MermaidChart = ({ chart }: { chart: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (ref.current) {
      setError(false);
      try {
        // Clean up the chart text - remove markdown code block markers
        let cleanChart = chart.trim().replace(/^```mermaid\n?/, '').replace(/\n?```$/, '').trim();
        
        // Skip rendering if chart is empty or too short to be valid
        if (!cleanChart || cleanChart.length < 10) {
          return;
        }

        // Sanitize the chart - replace problematic unicode characters
        cleanChart = cleanChart
          .replace(/[\u2011\u2012\u2013\u2014\u2015]/g, '-') // Replace various dashes with regular hyphen
          .replace(/[\u2018\u2019]/g, "'") // Replace smart quotes with regular quotes
          .replace(/[\u201C\u201D]/g, '"') // Replace smart double quotes
          .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
          .trim();

        // Validate basic mermaid syntax - check for incomplete arrows
        const lines = cleanChart.split('\n');
        const validLines = lines.filter(line => {
          const trimmedLine = line.trim();
          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith('%%')) return true;
          // Check for incomplete arrows (arrows that end the line without a destination)
          if (/--[->]?\s*$/.test(trimmedLine)) return false;
          return true;
        });
        
        if (validLines.length < lines.length) {
          console.warn('Mermaid: Removed incomplete arrow syntax');
          cleanChart = validLines.join('\n');
        }

        mermaid.render(`mermaid-${Date.now()}`, cleanChart).then(({ svg }) => {
          if (ref.current) {
            ref.current.innerHTML = svg;
          }
        }).catch((e) => {
          console.error('Mermaid rendering error:', e);
          setError(true);
        });
      } catch (e) {
        console.error('Mermaid rendering error:', e);
        setError(true);
      }
    }
  }, [chart]);

  if (error) {
    return (
      <div className="my-4 p-4 bg-muted/50 border border-border rounded-md">
        <p className="text-sm text-muted-foreground">
          Unable to render diagram. The chart syntax may be incomplete or invalid.
        </p>
      </div>
    );
  }

  return <div ref={ref} className="my-4 overflow-x-auto max-w-full" />;
};

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
          'max-w-[85%] md:max-w-[80%] px-4 py-3 break-words overflow-hidden',
          isUser
            ? 'bg-primary text-primary-foreground [&_.prose]:text-primary-foreground [&_.prose_*]:text-primary-foreground'
            : 'bg-muted'
        )}
      >
        <div className={cn(
          "prose prose-sm max-w-none",
          !isUser && "dark:prose-invert"
        )}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const code = String(children).replace(/\n$/, '');
                const inline = !className;
                
                // Check if it's a mermaid diagram
                if (match && match[1] === 'mermaid') {
                  return <MermaidChart chart={code} />;
                }
                
                // Regular code block
                if (!inline && match) {
                  return (
                    <pre className="bg-background/50 p-3 rounded-md overflow-x-auto max-w-full">
                      <code className={cn(className, 'block break-words whitespace-pre-wrap')} {...props}>
                        {children}
                      </code>
                    </pre>
                  );
                }
                
                // Inline code
                return (
                  <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm break-words" {...props}>
                    {children}
                  </code>
                );
              },
              a({ children, ...props }: any) {
                return (
                  <a {...props} className="text-primary hover:underline break-words" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
              ul({ children, ...props }: any) {
                return <ul className="list-disc list-inside space-y-1 break-words" {...props}>{children}</ul>;
              },
              ol({ children, ...props }: any) {
                return <ol className="list-decimal list-inside space-y-1 break-words" {...props}>{children}</ol>;
              },
              p({ children, ...props }: any) {
                return <p className="break-words" {...props}>{children}</p>;
              },
              h1({ children, ...props }: any) {
                return <h1 className="break-words text-xl md:text-2xl" {...props}>{children}</h1>;
              },
              h2({ children, ...props }: any) {
                return <h2 className="break-words text-lg md:text-xl" {...props}>{children}</h2>;
              },
              h3({ children, ...props }: any) {
                return <h3 className="break-words text-base md:text-lg" {...props}>{children}</h3>;
              },
              table({ children, ...props }: any) {
                return (
                  <div className="overflow-x-auto my-4 max-w-full">
                    <table className="min-w-full border-collapse border border-border" {...props}>
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children, ...props }: any) {
                return (
                  <th className="border border-border px-2 md:px-4 py-2 bg-muted font-semibold text-left text-xs md:text-sm break-words" {...props}>
                    {children}
                  </th>
                );
              },
              td({ children, ...props }: any) {
                return (
                  <td className="border border-border px-2 md:px-4 py-2 text-xs md:text-sm break-words" {...props}>
                    {children}
                  </td>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
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
