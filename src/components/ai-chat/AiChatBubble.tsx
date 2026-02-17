import { useState, useRef, useCallback, useEffect } from 'react';
import { ChefHat } from 'lucide-react';
import { useAiChatContext } from '@/contexts/AiChatContext';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { cn } from '@/lib/utils';

const POSITION_KEY = 'ai-chat-bubble-pos';
const BUBBLE_SIZE = 48;

function clampPosition(x: number, y: number) {
  const maxX = window.innerWidth - BUBBLE_SIZE;
  const maxY = window.innerHeight - BUBBLE_SIZE;
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return clampPosition(parsed.x, parsed.y);
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Floating, draggable chat bubble.
 * Defaults to bottom-right; user can drag it anywhere on screen.
 * Hidden for staff and kiosk users.
 */
export function AiChatBubble() {
  const { isOpen, isMinimized, openChat, expandChat } = useAiChatContext();
  const { selectedRestaurant } = useRestaurantContext();
  const role = selectedRestaurant?.role;

  // Position state — default to bottom-right
  const [position, setPosition] = useState(() => {
    return loadSavedPosition() ?? { x: window.innerWidth - BUBBLE_SIZE - 80, y: window.innerHeight - BUBBLE_SIZE - 24 };
  });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const hasMoved = useRef(false);

  // Re-clamp on window resize
  useEffect(() => {
    const handleResize = () => setPosition(prev => clampPosition(prev.x, prev.y));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    hasMoved.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved.current = true;
    const next = clampPosition(dragStart.current.posX + dx, dragStart.current.posY + dy);
    setPosition(next);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Save position
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));

    // If it was a click (not a drag), toggle chat
    if (!hasMoved.current) {
      if (isMinimized) {
        expandChat();
      } else {
        openChat();
      }
    }
  }, [position, isMinimized, expandChat, openChat]);

  // Hide for staff and kiosk users
  if (role === 'staff' || role === 'kiosk') return null;

  // Don't render if panel is fully open
  if (isOpen && !isMinimized) return null;

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ left: position.x, top: position.y }}
      className={cn(
        'fixed z-[100] touch-none select-none',
        'w-12 h-12 rounded-full',
        'bg-gradient-to-br from-primary to-primary/70',
        'shadow-lg shadow-primary/20',
        'hover:shadow-xl hover:shadow-primary/25',
        'transition-shadow duration-200',
        'flex items-center justify-center',
        'group',
        isDragging.current && 'cursor-grabbing'
      )}
      aria-label="Open Chef Assistant"
      title="Chef Assistant — drag to reposition"
    >
      <ChefHat className="w-5 h-5 text-primary-foreground group-hover:scale-110 transition-transform pointer-events-none" />
      {isMinimized && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-background pointer-events-none" />
      )}
    </button>
  );
}
