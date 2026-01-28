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
        'bg-gradient-to-br from-orange-400 to-amber-500',
        'shadow-lg shadow-orange-500/20',
        'hover:shadow-xl hover:shadow-orange-500/25',
        'hover:scale-105 active:scale-95',
        'transition-all duration-200',
        'flex items-center justify-center',
        'text-xl',
        'group'
      )}
      aria-label="Open Chef Assistant"
      title="Chef Assistant"
    >
      <span className="group-hover:animate-bounce">🧑‍🍳</span>
      {isMinimized && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-background" />
      )}
    </button>
  );
}
