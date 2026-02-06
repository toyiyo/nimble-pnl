import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface AiChatContextType {
  isOpen: boolean;
  isMinimized: boolean;
  currentSessionId: string | null;
  setIsOpen: (open: boolean) => void;
  setIsMinimized: (minimized: boolean) => void;
  openChat: (sessionId?: string) => void;
  closeChat: () => void;
  minimizeChat: () => void;
  expandChat: () => void;
  startNewConversation: () => void;
  switchSession: (sessionId: string) => void;
  clearCurrentSession: () => void;
}

const AiChatContext = createContext<AiChatContextType | null>(null);

// localStorage keys
const CHAT_OPEN_KEY = 'ai_chat_open';
const CHAT_MINIMIZED_KEY = 'ai_chat_minimized';
const CURRENT_SESSION_KEY = 'ai_chat_current_session';

interface AiChatProviderProps {
  children: React.ReactNode;
}

export function AiChatProvider({ children }: AiChatProviderProps) {
  // Initialize state from localStorage
  const [isOpen, setIsOpenState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(CHAT_OPEN_KEY) === 'true';
  });

  const [isMinimized, setIsMinimizedState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(CHAT_MINIMIZED_KEY) === 'true';
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CURRENT_SESSION_KEY);
  });

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem(CHAT_OPEN_KEY, String(isOpen));
  }, [isOpen]);

  useEffect(() => {
    localStorage.setItem(CHAT_MINIMIZED_KEY, String(isMinimized));
  }, [isMinimized]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem(CURRENT_SESSION_KEY, currentSessionId);
    } else {
      localStorage.removeItem(CURRENT_SESSION_KEY);
    }
  }, [currentSessionId]);

  const setIsOpen = useCallback((open: boolean) => {
    setIsOpenState(open);
  }, []);

  const setIsMinimized = useCallback((minimized: boolean) => {
    setIsMinimizedState(minimized);
  }, []);

  const openChat = useCallback((sessionId?: string) => {
    setIsOpenState(true);
    setIsMinimizedState(false);
    if (sessionId) {
      setCurrentSessionId(sessionId);
    }
  }, []);

  const closeChat = useCallback(() => {
    setIsOpenState(false);
    setIsMinimizedState(false);
  }, []);

  const minimizeChat = useCallback(() => {
    setIsMinimizedState(true);
  }, []);

  const expandChat = useCallback(() => {
    setIsMinimizedState(false);
  }, []);

  const startNewConversation = useCallback(() => {
    setCurrentSessionId(null);
    setIsOpenState(true);
    setIsMinimizedState(false);
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  const clearCurrentSession = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const value: AiChatContextType = {
    isOpen,
    isMinimized,
    currentSessionId,
    setIsOpen,
    setIsMinimized,
    openChat,
    closeChat,
    minimizeChat,
    expandChat,
    startNewConversation,
    switchSession,
    clearCurrentSession,
  };

  return <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>;
}

export function useAiChatContext() {
  const context = useContext(AiChatContext);
  if (!context) {
    throw new Error('useAiChatContext must be used within an AiChatProvider');
  }
  return context;
}
