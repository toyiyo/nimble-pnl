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
function SegmentButton({ icon: Icon, label, pressed, onClick }: SegmentButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
        pressed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
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
 * The segmented control is two `aria-pressed` toggle buttons inside a
 * `role="group"` — NOT `role="radiogroup"` (see design doc "Three-state /
 * a11y" — the CLAUDE.md "Apple-Style Underline Tabs" convention already used
 * in the codebase).
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("Mock-exact copy & layout" section).
 */
export function ViewModeSwitch() {
  const { viewMode, canUseWorkView, enterWorkMode, exitWorkMode } = useViewMode();

  if (!canUseWorkView) {
    return null;
  }

  return (
    <div className="rounded-lg border border-personal-view-border bg-personal-view/40 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        You&apos;re viewing as
      </p>
      <div
        role="group"
        aria-label="View mode"
        className="mt-1.5 flex items-center gap-0.5 rounded-lg bg-muted/30 p-0.5"
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
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        Switch to clock in, view your schedule, timecard, and pay.
      </p>
    </div>
  );
}
