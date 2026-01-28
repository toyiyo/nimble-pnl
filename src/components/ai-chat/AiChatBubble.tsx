import { Sparkles } from 'lucide-react';
import { useAiChatContext } from '@/contexts/AiChatContext';
import { cn } from '@/lib/utils';

/**
 * Floating chat bubble that appears in the bottom-right corner.
 * Clicking it opens the AI chat panel.
 */
export function AiChatBubble() {
  const { isOpen, isMinimized, openChat, expandChat } = useAiChatContext();

  // Don't render if panel is fully open
  if (isOpen && !isMinimized) return null;

  const handleClick = () => {
    if (isMinimized) {
      expandChat();
    } else {
      openChat();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'fixed bottom-6 right-20 z-[100]',
        'w-12 h-12 rounded-full',
        'bg-gradient-to-br from-violet-500 to-purple-600',
        'shadow-lg shadow-purple-500/20',
        'hover:shadow-xl hover:shadow-purple-500/25',
        'hover:scale-105 active:scale-95',
        'transition-all duration-200',
        'flex items-center justify-center',
        'group'
      )}
      aria-label="Open AI Assistant"
      title="AI Assistant"
    >
      <Sparkles
        className={cn(
          'w-5 h-5 text-white',
          'group-hover:animate-pulse'
        )}
      />
      {isMinimized && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-background" />
      )}
    </button>
  );
}
