import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { DisconnectIntegrationDialog } from '@/components/integrations/DisconnectIntegrationDialog';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

type Props = React.ComponentProps<typeof DisconnectIntegrationDialog>;

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    integrationName: 'Revel',
    restaurantName: 'Test Cafe',
    kind: 'pos',
    onConfirm: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <DisconnectIntegrationDialog {...props} />
    </MemoryRouter>,
  );
  return { props, ...utils };
}

const click = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('button', { name }));
const pick = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('radio', { name }));

describe('DisconnectIntegrationDialog', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubEnv('VITE_CS_BOOKING_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the POS impact on step 1', () => {
    setup();
    expect(screen.getByText(/Sales stop syncing today/)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('shows the bank impact on step 1', () => {
    setup({ kind: 'bank', integrationName: 'Chase' });
    expect(screen.getByText(/Transactions stop syncing today/)).toBeInTheDocument();
  });

  it('marks the current step with aria-current', () => {
    setup();
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
  });

  it('keeps the choice when Back is used', async () => {
    setup();
    await click('Continue');
    await pick(/switching to a different POS/);
    await click('Continue');
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await click('Back');
    expect(screen.getByRole('radio', { name: /switching to a different POS/ })).toBeChecked();
  });

  it('closes on "Keep my connection" for switching_pos', async () => {
    const { props } = setup();
    await click('Continue');
    await pick(/switching to a different POS/);
    await click('Keep my connection');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('closes then calls onReconnect for credentials_changed', async () => {
    const onReconnect = vi.fn();
    const { props } = setup({ onReconnect });
    await click('Continue');
    await pick(/My credentials changed/);
    await click('Update credentials');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(onReconnect).toHaveBeenCalled();
  });

  it('shows the pause note with no button for temporary_close', async () => {
    setup();
    await click('Continue');
    await pick(/closed for a while/);
    expect(screen.getByText(/Pause is coming soon/)).toBeInTheDocument();
  });

  it('hides "Book a call" when the variable is not set', async () => {
    setup();
    await click('Continue');
    await pick(/do not get value/);
    expect(screen.queryByRole('button', { name: 'Book a call' })).not.toBeInTheDocument();
  });

  it('opens the booking URL in a new tab when the variable is set', async () => {
    vi.stubEnv('VITE_CS_BOOKING_URL', 'https://example.com/book');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    setup();
    await click('Continue');
    await pick(/do not get value/);
    await click('Book a call');
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/book',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('navigates to the subscription tab for too_expensive', async () => {
    const { props } = setup();
    await click('Continue');
    await pick(/costs too much/);
    await click('Compare plans');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateMock).toHaveBeenCalledWith('/settings?tab=subscription');
  });

  it('confirms with a null reason when Skip is used', async () => {
    const { props } = setup();
    await click('Continue');
    await click('Skip');
    await click('Disconnect anyway');
    await waitFor(() =>
      expect(props.onConfirm).toHaveBeenCalledWith({ reason: null, reasonText: null }),
    );
  });

  it('limits the other text to 500 characters and shows a counter', async () => {
    setup();
    await click('Continue');
    await pick('Other');
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('maxlength', '500');
    fireEvent.change(box, { target: { value: 'abc' } });
    expect(screen.getByText('3/500')).toBeInTheDocument();
  });

  it('sends the reason and text on confirm', async () => {
    const { props } = setup();
    await click('Continue');
    await pick('Other');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'moving' } });
    await click('Continue');
    expect(screen.getByText('Test Cafe')).toBeInTheDocument();
    await click('Disconnect anyway');
    await waitFor(() =>
      expect(props.onConfirm).toHaveBeenCalledWith({ reason: 'other', reasonText: 'moving' }),
    );
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows an error Alert and stays open on failure', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    const { props } = setup({ onConfirm });
    await click('Continue');
    await click('Skip');
    await click('Disconnect anyway');
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('blocks a double click and a close while pending', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const { props } = setup({ onConfirm });
    await click('Continue');
    await click('Skip');
    const btn = screen.getByRole('button', { name: 'Disconnect anyway' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Disconnecting…')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    resolve();
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('resets to step 1 after close and reopen', async () => {
    const { rerender, props } = setup();
    await click('Continue');
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <DisconnectIntegrationDialog {...props} open={false} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <DisconnectIntegrationDialog {...props} open />
      </MemoryRouter>,
    );
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('disables confirm when confirmDisabled is set and shows extra content', async () => {
    setup({
      kind: 'bank',
      confirmDisabled: true,
      extraConfirmContent: <div>Delete data checkbox</div>,
    });
    await click('Continue');
    await click('Skip');
    expect(screen.getByText('Delete data checkbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect anyway' })).toBeDisabled();
  });

  it('uses a custom confirm label', async () => {
    setup({ confirmLabel: 'Disconnect bank' });
    await click('Continue');
    await click('Skip');
    expect(screen.getByRole('button', { name: 'Disconnect bank' })).toBeInTheDocument();
  });
});
