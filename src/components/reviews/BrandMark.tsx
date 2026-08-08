import { useState, type CSSProperties } from 'react';

import { initials } from '@/lib/reviews/reviewBranding';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  logoUrl: string | null;
  /** The restaurant name. Supplies the initials when there is no logo. */
  name: string;
  /** Applied to the logo and to the initials circle, so both get one size. */
  className?: string;
  style?: CSSProperties;
  /**
   * Lifts the broken flag to the parent. The sticker sheet draws six marks from
   * one URL, and one shared flag keeps all six the same on a single sheet.
   * Omit both props to keep the flag local.
   */
  broken?: boolean;
  onBroken?: () => void;
}

/**
 * The restaurant logo, or a circle of initials when there is no logo.
 *
 * The guest page and the printed sheet both show this mark. They held two
 * copies of the markup before, and the copies drifted: only one of them
 * handled a logo that fails to load.
 */
export function BrandMark({
  logoUrl,
  name,
  className,
  style,
  broken,
  onBroken,
}: BrandMarkProps) {
  const [localBroken, setLocalBroken] = useState(false);
  const isBroken = broken ?? localBroken;

  // A logo that fails to load must never leave a blank box, on screen or on
  // paper. Fall back to the initials circle.
  if (logoUrl && !isBroken) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => {
          setLocalBroken(true);
          onBroken?.();
        }}
        className={cn('rounded-full object-cover', className)}
        style={style}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        'counter-display flex items-center justify-center rounded-full bg-muted font-semibold text-foreground',
        className
      )}
      style={style}
    >
      {initials(name)}
    </div>
  );
}
