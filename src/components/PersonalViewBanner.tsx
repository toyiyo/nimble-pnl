import { useEffect, useState } from 'react';
import { ArrowLeft, UserRound } from 'lucide-react';

import { useViewMode } from '@/contexts/ViewModeContext';
import { cn } from '@/lib/utils';

/**
 * `usePrefersReducedMotion` — mirrors the `(prefers-reduced-motion: reduce)`
 * media query so the banner's entrance animation can be omitted entirely
 * (design doc "Visual language": "fade fallback, no sweep").
 */
function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefersReducedMotion(mql.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

export interface PersonalViewBannerProps {
  /** `"desktop"` — full-width bar above main content. `"mobile"` — slim strip above the tab bar. */
  variant: 'desktop' | 'mobile';
}

/**
 * `PersonalViewBanner` — the persistent slate banner shown while in work
 * mode, guiding the user back to admin. `role="status"` announces the mode
 * without stealing focus during navigation.
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("Mock-exact copy & layout" section).
 */
export function PersonalViewBanner({ variant }: PersonalViewBannerProps) {
  const { exitWorkMode } = useViewMode();
  const prefersReducedMotion = usePrefersReducedMotion();
  const animationClass = prefersReducedMotion ? undefined : 'animate-in fade-in slide-in-from-top-1';

  if (variant === 'mobile') {
    return (
      <div
        role="status"
        className={cn(
          'flex items-center justify-between gap-2 border-t border-personal-view-border bg-personal-view px-4 py-2 text-personal-view-foreground',
          'pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
          animationClass
        )}
      >
        <div className="flex items-center gap-1.5">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span className="text-[13px] font-medium">Personal view</span>
        </div>
        <button
          type="button"
          aria-label="Back to admin"
          onClick={exitWorkMode}
          className="text-[13px] font-medium text-personal-view-foreground hover:opacity-80"
        >
          <span>Admin &rsaquo;</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border border-personal-view-border bg-personal-view px-4 py-3 text-personal-view-foreground',
        animationClass
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-personal-view-border/40">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </div>
        <p className="text-[14px]">
          <span className="font-semibold">You&apos;re in your personal view.</span>{' '}
          <span className="text-muted-foreground">
            Seeing your own schedule &amp; pay — not the restaurant&apos;s admin tools.
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={exitWorkMode}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-personal-view-foreground transition-colors hover:bg-background/40"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to admin
      </button>
    </div>
  );
}
