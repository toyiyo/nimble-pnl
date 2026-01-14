import { Button } from "@/components/ui/button";
import { X, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  selectedCount: number;
  onClose: () => void;
  actions: Array<{
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  }>;
  moreActions?: Array<{
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  }>;
  className?: string;
}

/**
 * Floating bottom action bar for bulk operations
 * Follows Notion / iOS Share Sheet pattern
 * - Sticky at bottom of viewport
 * - Shows count of selected items
 * - Provides primary actions inline
 * - Optional "More" dropdown for additional actions
 */
export function BulkActionBar({
  selectedCount,
  onClose,
  actions,
  moreActions,
  className,
}: BulkActionBarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "bg-background border border-border rounded-2xl shadow-2xl",
        "px-6 py-4 flex items-center gap-4",
        "animate-in slide-in-from-bottom-8 duration-300",
        "max-w-[95vw] md:max-w-4xl w-full md:w-auto",
        className
      )}
      role="toolbar"
      aria-label="Bulk actions"
    >
      {/* Selection count */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <span className="text-sm font-semibold whitespace-nowrap">
          {selectedCount} selected
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
          onClick={onClose}
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Vertical divider */}
      <div className="h-8 w-px bg-border flex-shrink-0" />

      {/* Primary actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {actions.map((action, index) => (
          <Button
            key={index}
            variant={action.variant || 'outline'}
            size="sm"
            onClick={action.onClick}
            className="gap-2 whitespace-nowrap"
          >
            {action.icon}
            {action.label}
          </Button>
        ))}

        {/* More actions dropdown */}
        {moreActions && moreActions.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <MoreHorizontal className="h-4 w-4" />
            More
          </Button>
        )}
      </div>
    </div>
  );
}
