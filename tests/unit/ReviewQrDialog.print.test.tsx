import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://stub.test/${bucket}/${path}` },
        }),
      }),
    },
  },
}));

vi.mock('qrcode', () => ({
  toString: (_text: string, options: { margin: number }) =>
    Promise.resolve(`<svg data-margin="${options.margin}"><rect /></svg>`),
  toDataURL: () => Promise.resolve('data:image/png;base64,stub'),
}));

import { ReviewQrDialog } from '@/components/reviews/ReviewQrDialog';

const PROPS = {
  open: true,
  onOpenChange: () => {},
  slug: 'blue-fin',
  publicUrl: 'https://app.test/r/blue-fin',
  restaurantName: 'Blue Fin Sushi',
  logoPath: null,
  defaultMessage: 'How was everything?',
};

/** The live region is the only sr-only paragraph in the dialog. */
function liveText(): string {
  return document.querySelector('[aria-live]')?.textContent ?? '';
}

describe('ReviewQrDialog print sheet', () => {
  beforeEach(() => {
    vi.stubGlobal('print', vi.fn());
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      get: () => ({ ready: Promise.resolve() }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts the message at defaultMessage', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    const input = await screen.findByLabelText(/message/i);
    expect(input).toHaveValue('How was everything?');
  });

  it('resets the message when the dialog closes and reopens', async () => {
    const { rerender } = render(<ReviewQrDialog {...PROPS} />);
    const input = await screen.findByLabelText(/message/i);
    fireEvent.change(input, { target: { value: 'Tell us how we did' } });
    expect(input).toHaveValue('Tell us how we did');

    rerender(<ReviewQrDialog {...PROPS} open={false} />);
    rerender(<ReviewQrDialog {...PROPS} open={true} />);

    expect(await screen.findByLabelText(/message/i)).toHaveValue('How was everything?');
  });

  it('shows the typed message on the sheet', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    const input = await screen.findByLabelText(/message/i);
    fireEvent.change(input, { target: { value: 'Tell us how we did' } });

    // One props object drives both mounts, so both must show the new text.
    await waitFor(() => {
      const hits = Array.from(document.querySelectorAll('.print-tile')).filter((tile) =>
        tile.textContent?.includes('Tell us how we did')
      );
      expect(hits).toHaveLength(2);
    });
  });

  it('generates a wider quiet zone for the sheet than for the download', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    await waitFor(() => {
      expect(document.querySelector('#review-print-root svg')).toHaveAttribute('data-margin', '4');
    });
  });

  it('calls window.print only after the sheet is ready', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    const button = await screen.findByRole('button', { name: /^print$/i });
    await waitFor(() => expect(button).toBeEnabled());

    expect(window.print).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  });

  it('announces a different string on a second print', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    const button = await screen.findByRole('button', { name: /^print$/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const first = liveText();

    fireEvent.click(button);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
    // aria-live reports a change. An identical string announces nothing, so a
    // second print would be silent to a screen reader.
    expect(liveText()).not.toBe(first);
  });

  it('changes data-size on the print root when the size changes', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    await waitFor(() =>
      expect(document.querySelector('#review-print-root')).toHaveAttribute('data-size', 'tent')
    );

    fireEvent.click(await screen.findByRole('radio', { name: /counter card/i }));

    await waitFor(() =>
      expect(document.querySelector('#review-print-root')).toHaveAttribute('data-size', 'card')
    );
  });

  it('mounts no print root while the dialog is closed', () => {
    render(<ReviewQrDialog {...PROPS} open={false} />);
    expect(document.querySelector('#review-print-root')).toBeNull();
  });

  it('caps the message input at 120 characters', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    expect(await screen.findByLabelText(/message/i)).toHaveAttribute('maxlength', '120');
  });

  it('keeps a typed message when the saved headline changes underneath', async () => {
    // useReviewPages refetches on window focus. A second manager can save a new
    // headline while this one types a one-off message for the paper.
    const { rerender } = render(<ReviewQrDialog {...PROPS} />);
    const input = await screen.findByLabelText(/message/i);
    fireEvent.change(input, { target: { value: 'Tell us how we did' } });

    rerender(<ReviewQrDialog {...PROPS} defaultMessage="A brand new headline" />);

    expect(await screen.findByLabelText(/message/i)).toHaveValue('Tell us how we did');
  });

  it('does not print when the dialog closes during the wait', async () => {
    const { rerender } = render(<ReviewQrDialog {...PROPS} />);
    const button = await screen.findByRole('button', { name: /^print$/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    // Close before waitForPrintReady resolves. The system print dialog would
    // otherwise open over a screen the manager already dismissed.
    rerender(<ReviewQrDialog {...PROPS} open={false} />);

    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(window.print).not.toHaveBeenCalled();
  });

  it('announces the ready status before it opens the print dialog', async () => {
    // `window.print()` blocks the main thread until the manager dismisses the
    // system dialog. Without a frame yield React never paints the new status,
    // and a screen reader user hears "Preparing" and then nothing.
    let statusAtPrint = '';
    vi.stubGlobal(
      'print',
      vi.fn(() => {
        statusAtPrint = liveText();
      })
    );

    render(<ReviewQrDialog {...PROPS} />);
    const button = await screen.findByRole('button', { name: /^print$/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(statusAtPrint).toMatch(/sheet ready/i);
  });

  it('holds the print class on body only while the dialog is open', async () => {
    const { rerender } = render(<ReviewQrDialog {...PROPS} />);
    await waitFor(() => expect(document.body).toHaveClass('review-print-active'));

    // The print rule hides every other body child. Left behind, it makes every
    // other page in the app print a blank sheet.
    rerender(<ReviewQrDialog {...PROPS} open={false} />);
    expect(document.body).not.toHaveClass('review-print-active');
  });

  it('names the preview for a screen reader', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    // The sheet itself is aria-hidden. Without this wrapper the dialog gives a
    // screen reader no restaurant name and no destination for the code.
    const preview = await screen.findByRole('img', { name: /preview of the/i });
    expect(preview).toHaveAccessibleName(/Blue Fin Sushi/);
    expect(preview).toHaveAccessibleName(/https:\/\/app\.test\/r\/blue-fin/);
  });

  it('names the paper size radio group', async () => {
    render(<ReviewQrDialog {...PROPS} />);
    // `label htmlFor` names labelable elements only. RadioGroup renders a div,
    // so the group needs aria-labelledby to announce with a name.
    expect(await screen.findByRole('radiogroup', { name: /paper size/i })).toBeInTheDocument();
  });
});
