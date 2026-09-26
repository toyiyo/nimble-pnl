import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useSyncExternalStore } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChatMessage } from '@/types/ai-chat';

/**
 * A small store for the chat context and the mocked hooks. A change in the
 * store renders the panel again, like a change in the real context.
 */
const store = vi.hoisted(() => {
  type State = {
    currentSessionId: string | null;
    dbMessages: ChatMessage[];
    messages: ChatMessage[];
    isStreaming: boolean;
    restaurantId: string;
  };
  let state: State = { currentSessionId: null, dbMessages: [], messages: [], isStreaming: false, restaurantId: 'rest-1' };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch: Partial<State>) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset: (next: State) => {
      state = next;
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

const spies = vi.hoisted(() => ({
  abortStream: vi.fn(),
  clearMessages: vi.fn(),
  setMessages: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
  saveMessagesBatch: vi.fn(async () => undefined),
  createSession: vi.fn(async () => ({ id: 'session-new' })),
  updateTitle: vi.fn(),
  clearCurrentSession: vi.fn(),
}));

function useStore() {
  return useSyncExternalStore(store.subscribe, store.get);
}

vi.mock('@/contexts/AiChatContext', () => ({
  useAiChatContext: () => {
    const state = useStore();
    return {
      isOpen: true,
      isMinimized: false,
      currentSessionId: state.currentSessionId,
      closeChat: vi.fn(),
      minimizeChat: vi.fn(),
      switchSession: (id: string) => store.set({ currentSessionId: id }),
      clearCurrentSession: spies.clearCurrentSession,
    };
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: useStore().restaurantId, role: 'owner' },
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ hasFeature: () => true }),
}));

vi.mock('@/hooks/useAiChatSessions', () => ({
  useAiChatSessions: () => ({ createSession: spies.createSession, updateTitle: spies.updateTitle }),
}));

vi.mock('@/hooks/useAiChatMessages', () => ({
  useAiChatMessages: () => ({ messages: useStore().dbMessages, saveMessagesBatch: spies.saveMessagesBatch }),
}));

vi.mock('@/hooks/useAiChat', () => ({
  useAiChat: () => {
    const state = useStore();
    return {
      messages: state.messages,
      isStreaming: state.isStreaming,
      error: null,
      sendMessage: spies.sendMessage,
      clearMessages: spies.clearMessages,
      abortStream: spies.abortStream,
      setMessages: spies.setMessages,
    };
  },
}));

vi.mock('@/components/ai-chat/AiChatConversationList', () => ({
  AiChatConversationList: ({ onNewConversation }: { onNewConversation: () => void }) => (
    <button type="button" onClick={onNewConversation}>
      New conversation
    </button>
  ),
}));

vi.mock('@/components/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: ChatMessage }) => <div>{message.content}</div>,
}));

import { AiChatPanel } from '@/components/ai-chat/AiChatPanel';

const row = (id: string, role: ChatMessage['role'], content: string): ChatMessage => ({ id, role, content });

function renderPanel() {
  return render(
    <MemoryRouter>
      <AiChatPanel />
    </MemoryRouter>
  );
}

describe('AiChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset({ currentSessionId: 'session-a', dbMessages: [], messages: [], isStreaming: false, restaurantId: 'rest-1' });
    spies.createSession.mockImplementation(async () => ({ id: 'session-new' }));
    spies.sendMessage.mockImplementation(async () => undefined);
  });

  it('stops the running turn when the user switches to another session', () => {
    store.set({ isStreaming: true, messages: [row('u1', 'user', 'Q')] });
    renderPanel();
    // The first load of a session also calls these. They have no effect then.
    spies.abortStream.mockClear();
    spies.clearMessages.mockClear();

    act(() => store.set({ currentSessionId: 'session-b' }));

    expect(spies.abortStream).toHaveBeenCalled();
    // The rows of session A must not stay in the view of session B.
    expect(spies.clearMessages).toHaveBeenCalled();
  });

  it('stops the running turn when the user starts a new conversation', async () => {
    store.set({ isStreaming: true });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Show conversations' }));
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(spies.abortStream).toHaveBeenCalled();
    await waitFor(() => expect(spies.createSession).toHaveBeenCalled());
  });

  it('does not stop the first turn of the session that the submit creates', async () => {
    store.reset({ currentSessionId: null, dbMessages: [], messages: [], isStreaming: false, restaurantId: 'rest-1' });
    spies.sendMessage.mockImplementation(async () => {
      store.set({ isStreaming: true });
    });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Chat message input'), { target: { value: 'How are sales?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(spies.sendMessage).toHaveBeenCalledWith('How are sales?'));
    await waitFor(() => expect(store.get().currentSessionId).toBe('session-new'));
    expect(spies.abortStream).not.toHaveBeenCalled();
    expect(spies.clearMessages).not.toHaveBeenCalled();
  });

  it('does not replace the messages with loaded rows while a turn streams', () => {
    store.set({ isStreaming: true, messages: [row('u1', 'user', 'Q')] });
    renderPanel();

    act(() => store.set({ dbMessages: [row('db-1', 'user', 'Old'), row('db-2', 'assistant', 'Old answer')] }));
    expect(spies.setMessages).not.toHaveBeenCalled();

    // After the turn, the panel merges the loaded rows with the rows of the turn.
    act(() => store.set({ isStreaming: false }));
    expect(spies.setMessages).toHaveBeenCalledTimes(1);
    const update = spies.setMessages.mock.calls[0][0] as (prev: ChatMessage[]) => ChatMessage[];
    expect(update([row('u1', 'user', 'Q')]).map((m) => m.id)).toEqual(['db-1', 'db-2', 'u1']);
  });

  it('saves the rows of a turn into the session of that turn', async () => {
    store.set({ messages: [row('u1', 'user', 'Q'), row('a1', 'assistant', 'A')] });
    renderPanel();

    await waitFor(() => expect(spies.saveMessagesBatch).toHaveBeenCalled());
    const saved = spies.saveMessagesBatch.mock.calls[0][0] as Array<ChatMessage & { session_id: string }>;
    expect(saved.map((m) => [m.id, m.session_id])).toEqual([
      ['u1', 'session-a'],
      ['a1', 'session-a'],
    ]);
  });
  it('stops the turn and clears the session and the messages when the restaurant changes', () => {
    store.set({ isStreaming: true, messages: [row('u1', 'user', 'Q')] });
    renderPanel();
    spies.abortStream.mockClear();
    spies.clearMessages.mockClear();
    expect(spies.clearCurrentSession).not.toHaveBeenCalled();

    act(() => store.set({ restaurantId: 'rest-2' }));

    expect(spies.abortStream).toHaveBeenCalled();
    expect(spies.clearCurrentSession).toHaveBeenCalledTimes(1);
    expect(spies.clearMessages).toHaveBeenCalled();
  });

  it('keeps the saved session when the restaurant loads for the first time', () => {
    store.set({ restaurantId: '' });
    renderPanel();

    act(() => store.set({ restaurantId: 'rest-1' }));

    expect(spies.clearCurrentSession).not.toHaveBeenCalled();
  });

  it('creates one session when the user submits twice while createSession waits', async () => {
    store.set({ currentSessionId: null });
    let resolveSession!: (value: { id: string }) => void;
    spies.createSession.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveSession = resolve;
        })
    );
    renderPanel();

    fireEvent.change(screen.getByLabelText('Chat message input'), { target: { value: 'How are sales?' } });
    const form = screen.getByLabelText('Chat message input').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(spies.createSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSession({ id: 'session-new' });
    });
    await waitFor(() => expect(spies.sendMessage).toHaveBeenCalledTimes(1));
  });

  it('lets the user submit again after createSession fails', async () => {
    store.set({ currentSessionId: null });
    spies.createSession.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Chat message input'), { target: { value: 'Hi' } });
    const form = screen.getByLabelText('Chat message input').closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(spies.createSession).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(spies.sendMessage).toHaveBeenCalledWith('Hi'));
  });

  it('clears the messages when the current session becomes null and no turn runs', () => {
    store.set({ messages: [row('u1', 'user', 'Q'), row('a1', 'assistant', 'A')] });
    renderPanel();
    spies.clearMessages.mockClear();

    act(() => store.set({ currentSessionId: null }));

    expect(spies.clearMessages).toHaveBeenCalled();
  });
});
