import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg></svg>' })),
  },
}));

import { ChatMessage } from '@/components/ChatMessage';
import type { ChatMessage as ChatMessageType, ToolCall } from '@/types/ai-chat';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderMessage(message: ChatMessageType) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ChatMessage message={message} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const navigateCall = (args: Record<string, unknown>): ToolCall => ({
  id: 'call_nav',
  type: 'function',
  function: { name: 'navigate', arguments: JSON.stringify(args) },
});

describe('ChatMessage', () => {
  it('renders nothing for an empty assistant message with tool_calls: []', () => {
    renderMessage({ id: 'a1', role: 'assistant', content: '', tool_calls: [] });
    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    expect(screen.queryByText(/Using tools/)).not.toBeInTheDocument();
    expect(document.querySelector('.prose')).toBeNull();
  });

  it('renders nothing for an empty assistant message with no tool_calls', () => {
    renderMessage({ id: 'a1', role: 'assistant', content: '   ' });
    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    expect(document.querySelector('.prose')).toBeNull();
  });

  it('shows "Go to POS Sales" and the tool line for an empty message with a navigate call', () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      content: '',
      tool_calls: [navigateCall({ section: 'pos-sales' })],
    });

    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Go to POS Sales' });
    expect(screen.getByText('Using tools: navigate')).toBeInTheDocument();
    // No empty markdown block and no divider above the first block.
    expect(document.querySelector('.prose')).toBeNull();
    expect(button.parentElement).not.toHaveClass('border-t');

    fireEvent.click(button);
    expect(screen.getByTestId('location')).toHaveTextContent('/pos-sales');
  });

  it('adds the entity ID to the navigate path', () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      content: 'Here is the recipe.',
      tool_calls: [navigateCall({ section: 'recipes', entity_id: 'r-9' })],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Recipes' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/recipes?id=r-9');
  });

  it('shows the names of the tools in the tool line', () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      content: 'Sales are up.',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'get_kpis', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'get_sales_summary', arguments: '{}' } },
      ],
    });

    expect(screen.getByText('Using tools: get_kpis, get_sales_summary')).toBeInTheDocument();
  });

  it('renders the text of an assistant message as markdown', () => {
    renderMessage({ id: 'a1', role: 'assistant', content: 'Revenue is **$1,200**.' });
    expect(screen.getByText('$1,200').tagName).toBe('STRONG');
  });

  it('renders the text of a user message', () => {
    renderMessage({ id: 'u1', role: 'user', content: 'How are sales?' });
    expect(screen.getByText('How are sales?')).toBeInTheDocument();
  });

  it('renders nothing for a tool message', () => {
    renderMessage({ id: 't1', role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' });
    expect(screen.queryByText('{"ok":true}')).not.toBeInTheDocument();
  });

  it('hides the icons from assistive technology', () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      content: 'Go there.',
      tool_calls: [navigateCall({ section: 'inventory' })],
    });
    const icons = document.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });
});
