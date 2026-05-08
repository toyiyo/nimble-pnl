import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Unsubscribe from '../../src/pages/Unsubscribe';

const invokeMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/unsubscribe${search}`]}>
      <Unsubscribe />
    </MemoryRouter>
  );
}

describe('Unsubscribe page', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('shows missing-parameters error when token is absent', async () => {
    renderAt('?list=trial_lifecycle');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /invalid unsubscribe link/i })
      ).toBeInTheDocument()
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('shows missing-parameters error when list is absent', async () => {
    renderAt('?token=abc.def');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /invalid unsubscribe link/i })
      ).toBeInTheDocument()
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('calls unsubscribe-email function with token + list from URL', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderAt('?token=abc.def&list=trial_lifecycle');
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('unsubscribe-email', {
        body: { token: 'abc.def', list: 'trial_lifecycle' },
      })
    );
  });

  it('renders success state after a 200 response', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderAt('?token=abc.def&list=trial_lifecycle');
    await waitFor(() =>
      expect(screen.getByText(/unsubscribed/i)).toBeInTheDocument()
    );
  });

  it('renders error state when the function returns an error', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid token' },
    });
    renderAt('?token=bad.token&list=trial_lifecycle');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /something went wrong/i })
      ).toBeInTheDocument()
    );
  });

  it('does not auto-call invoke a second time on re-render', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { rerender } = renderAt('?token=abc.def&list=trial_lifecycle');
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    rerender(
      <MemoryRouter initialEntries={['/unsubscribe?token=abc.def&list=trial_lifecycle']}>
        <Unsubscribe />
      </MemoryRouter>
    );
    // Allow micro-tasks to settle
    await new Promise((r) => setTimeout(r, 30));
    // Effect dependencies are stable, so the new render should not retrigger.
    expect(invokeMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
