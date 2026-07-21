import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { EditableLaborTarget } from '@/components/labor/EditableLaborTarget';

describe('EditableLaborTarget', () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it('is a labeled, accessible number input showing the current target', () => {
    render(<EditableLaborTarget targetPct={22} onCommit={vi.fn()} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(22);
  });

  it('commits once on blur when the value changed', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.type(input, '28');
    await user.tab(); // blur

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith(28);
  });

  it('clamps an out-of-range value to [1, 100] before committing', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.type(input, '500'); // above max
    await user.tab();

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith(100);
    expect(input).toHaveValue(100);
  });

  it('clamps a zero/negative value up to 1 instead of committing garbage', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.type(input, '0');
    await user.tab();

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it('does not commit on blur when the value is unchanged (dirty check)', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.click(input);
    await user.tab(); // blur without typing anything

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('fires the handler exactly once when Enter is pressed and then blur follows (no double-commit)', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.type(input, '30');
    await user.keyboard('{Enter}');
    await user.tab(); // blur right after Enter — must be a no-op

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith(30);
  });

  it('optimistically reflects the new value immediately after commit', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.type(input, '25');
    await user.tab();

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue(25);
  });

  it('reverts to the previous value and shows an error toast when the commit fails', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.type(input, '40');
    await user.tab();

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input).toHaveValue(22));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('re-syncs its displayed value when targetPct changes externally', () => {
    const { rerender } = render(<EditableLaborTarget targetPct={22} onCommit={vi.fn()} />);
    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    expect(input).toHaveValue(22);

    rerender(<EditableLaborTarget targetPct={26} onCommit={vi.fn()} />);
    expect(input).toHaveValue(26);
  });

  it('does not commit an empty or non-numeric value; reverts to the last committed value', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EditableLaborTarget targetPct={22} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton', { name: /target labor cost percentage/i });
    await user.clear(input);
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue(22);
  });
});
