import { LayoutDashboard, UserRound, type LucideIcon } from 'lucide-react';

import { useViewMode } from '@/contexts/ViewModeContext';
import { cn } from '@/lib/utils';

interface SegmentButtonProps {
  icon: LucideIcon;
  label: string;
  pressed: boolean;
  onClick: () => void;
}

/** One toggle button of the Admin / My Work segmented control. */
function SegmentButton({ icon: Icon, label, pressed, onClick }: Readonly<SegmentButtonProps>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
        pressed
          ? 'bg-background text-foreground shadow-sm'
          : 'text-personal-view-foreground/80 hover:text-personal-view-foreground'
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * `ViewModeSwitch` — the "You're viewing as" persona card.
 *
 * Renders `null` when the current user is ineligible for work view
 * (`!canUseWorkView`) — fails closed, no empty shell. When eligible, renders
 * a compact segmented control (Admin / My Work) plus a hint line. Mounted at
 * two places (the `UserProfileDropdown` and the expanded `SidebarFooter`), so
 * layout stays compact/truncating to fit both widths.
 *
 * The card paints its **own** opaque surface (`bg-personal-view`) and pairs it
 * with its **own** foreground (`text-personal-view-foreground`), so it renders
 * identically in both mounts. Do not reintroduce alpha on the card, and do not
 * put `text-muted-foreground`/`text-foreground` on anything sitting directly on
 * `bg-personal-view` (the eyebrow, the hint, the *unpressed* segment): those
 * tokens are scoped to the main-content surface, but the sidebar is dark *even
 * in light theme* (`--sidebar-background: 30 15% 12%`). The original version
 * did both — `bg-personal-view/40` let the dark sidebar bleed through into a
 * mid-gray, on which `text-muted-foreground` measured 1.03:1.
 *
 * The *pressed* segment is the one deliberate exception: it paints its own
 * `bg-background`, so `text-foreground` is the correctly paired token there.
 * The rule is "pair the foreground to the surface you're actually on", not
 * "never name these tokens". Guarded by tests/unit/ViewModeSwitch.contrast.test.tsx.
 *
 * The segmented control is two `aria-pressed` toggle buttons inside a
 * `<fieldset>` (implicit `role="group"`) — NOT `role="radiogroup"` (see design doc "Three-state /
 * a11y" — the CLAUDE.md "Apple-Style Underline Tabs" convention already used
 * in the codebase).
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("Mock-exact copy & layout" section).
 *
 * `className` merges onto the card's own root — it does NOT wrap in an
 * extra element. That keeps the "renders null when ineligible, no empty
 * shell" guarantee intact for callers that need mount-specific spacing
 * (e.g. `UserProfileDropdown` aligning it with the dropdown's padding):
 * a wrapping `<div>` supplied by the caller would still render (with its
 * padding) even when this component itself renders `null`.
 */
export function ViewModeSwitch({ className }: { className?: string } = {}) {
  const { viewMode, canUseWorkView, enterWorkMode, exitWorkMode } = useViewMode();

  if (!canUseWorkView) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-personal-view-border bg-personal-view p-2.5',
        className
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-personal-view-foreground">
        You&apos;re viewing as
      </p>
      {/*
        `<fieldset>` — not `<div role="group">`. Same implicit ARIA role, but the
        semantic element keeps assistive tech working where the explicit role is
        unevenly supported (sonar typescript:S6819). `min-w-0` is required: a
        fieldset's default `min-inline-size: min-content` would otherwise stop the
        card shrinking to the collapsed sidebar's width.
      */}
      <fieldset
        aria-label="View mode"
        className="mt-1.5 flex min-w-0 items-center gap-0.5 rounded-lg bg-muted/30 p-0.5"
      >
        <SegmentButton
          icon={LayoutDashboard}
          label="Admin"
          pressed={viewMode === 'admin'}
          onClick={exitWorkMode}
        />
        <SegmentButton
          icon={UserRound}
          label="My Work"
          pressed={viewMode === 'work'}
          onClick={enterWorkMode}
        />
      </fieldset>
      <p className="mt-1.5 text-[12px] text-personal-view-foreground/80">
        Switch to clock in, view your schedule, timecard, and pay.
      </p>
    </div>
  );
}
