import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface BulkActionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  onApply: () => void;
  applyLabel?: string;
  isApplying?: boolean;
  previewContent?: React.ReactNode;
  className?: string;
}

/**
 * Right-side inspector panel for bulk edit operations
 * Follows Notion's database property edit pattern
 * - Slides in from right (360-420px width)
 * - Background stays visible (non-blocking)
 * - Shows preview of changes
 * - Clear apply/cancel actions
 */
export function BulkActionPanel({
  isOpen,
  onClose,
  title,
  children,
  onApply,
  applyLabel = "Apply",
  isApplying = false,
  previewContent,
  className,
}: BulkActionPanelProps) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop with click to close */}
      <div
        className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 w-full sm:w-[420px] z-50",
          "bg-background border-l border-border shadow-2xl",
          "flex flex-col",
          "animate-in slide-in-from-right duration-300",
          className
        )}
        role="dialog"
        aria-labelledby="bulk-action-panel-title"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <h2 id="bulk-action-panel-title" className="text-lg font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content area - scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {children}

          {/* Preview section */}
          {previewContent && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                Preview Changes
              </h3>
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                {previewContent}
              </div>
            </div>
          )}
        </div>

        {/* Footer with actions */}
        <div className="p-6 border-t border-border flex-shrink-0 space-y-2">
          <Button
            onClick={onApply}
            disabled={isApplying}
            className="w-full"
            size="lg"
          >
            {isApplying ? 'Applying...' : applyLabel}
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isApplying}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}
