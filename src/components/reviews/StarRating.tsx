import { useRef, useState, KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

interface StarRatingProps {
  /** The previewed star, 0 when nothing is focused yet. */
  value: number;
  onPreview: (rating: number) => void;
  onCommit: (rating: number) => void;
  disabled?: boolean;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * A radiogroup whose arrow keys PREVIEW rather than select.
 *
 * The ARIA APG radio pattern makes arrow keys check the newly-focused radio.
 * Here the rating is written the instant it is selected and selection moves
 * focus to the next branch's heading — so a keyboard user pressing → once from
 * star 1 would file a 2, be branched on it, and lose access to stars 3–5.
 *
 * Arrow keys therefore move a roving tabindex and update aria-checked for
 * preview only; the write fires on Enter, Space, or a tap. Radix RadioGroup
 * implements selection-follows-focus and cannot be used as-is for this reason.
 */
export function StarRating({ value, onPreview, onCommit, disabled = false }: StarRatingProps) {
  const [focused, setFocused] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const active = focused || value || 1;

  // Preview follows focus — including the plain Tab that first enters the
  // group. Without this, tabbing in leaves every star aria-checked="false"
  // and visually empty while the focus ring sits on star 1, so a screen
  // reader user pressing Enter files a rating nothing ever announced.
  // Previewing is not selecting: the write still needs Enter, Space, or a tap.
  const preview = (star: number) => {
    setFocused(star);
    onPreview(star);
  };

  const moveTo = (next: number) => {
    const clamped = Math.min(5, Math.max(1, next));
    // Idempotent with the onFocus below, which fires from the .focus() call.
    preview(clamped);
    refs.current[clamped - 1]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, star: number) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo(star + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo(star - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(1);
        break;
      case 'End':
        event.preventDefault();
        moveTo(5);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onCommit(star);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Rate your visit from 1 to 5 stars"
      className="flex items-center justify-center gap-2"
    >
      {STARS.map((star) => (
        <button
          key={star}
          ref={(el) => {
            refs.current[star - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} out of 5 stars`}
          tabIndex={star === active ? 0 : -1}
          disabled={disabled}
          onFocus={() => preview(star)}
          onKeyDown={(event) => handleKeyDown(event, star)}
          onClick={() => onCommit(star)}
          className={cn(
            'counter-display select-none rounded-md px-1 text-[44px] leading-none transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            star <= value ? 'text-primary' : 'text-muted-foreground/40',
            disabled && 'opacity-60'
          )}
        >
          {star <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}
