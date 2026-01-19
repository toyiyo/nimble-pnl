import { useRef } from 'react';
import { Plus, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AttachmentThumbnail, type Attachment } from './AttachmentThumbnail';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface AttachmentRailProps {
  attachments: Attachment[];
  onAdd?: () => void;
  onRemove?: (attachmentId: string) => void;
  onView: (attachment: Attachment) => void;
  showInheritedLabel?: string;
  readOnly?: boolean;
  isReconciled?: boolean;
  className?: string;
}

export function AttachmentRail({
  attachments,
  onAdd,
  onRemove,
  onView,
  showInheritedLabel,
  readOnly = false,
  isReconciled = false,
  className,
}: AttachmentRailProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Don't render anything if no attachments and readOnly
  if (attachments.length === 0 && readOnly) {
    return null;
  }

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const scrollAmount = 80;
    scrollContainerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const hasMultiple = attachments.length > 3;
  const hasInherited = attachments.some((a) => a.isInherited);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2">
        {/* Scroll left button */}
        {hasMultiple && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => scroll('left')}
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Thumbnails container */}
        <div
          ref={scrollContainerRef}
          className={cn(
            'flex items-center gap-2 overflow-x-auto scrollbar-hide',
            hasMultiple && 'flex-1'
          )}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {attachments.map((attachment) => (
            <AttachmentThumbnail
              key={attachment.id}
              attachment={attachment}
              onView={onView}
              onRemove={readOnly ? undefined : onRemove}
            />
          ))}

          {/* Add button */}
          {!readOnly && onAdd && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onAdd}
                    className={cn(
                      'h-16 w-16 shrink-0 rounded-lg border-2 border-dashed border-border',
                      'flex items-center justify-center',
                      'text-muted-foreground hover:text-foreground hover:border-primary/50',
                      'transition-colors duration-200 bg-transparent',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
                    )}
                    aria-label="Add receipt or invoice"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Add receipt or invoice</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Scroll right button */}
        {hasMultiple && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => scroll('right')}
            aria-label="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}

        {/* Reconciliation badge */}
        {isReconciled && attachments.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-green-600 dark:text-green-500">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Receipt linked to bank transaction</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Inherited label */}
      {hasInherited && showInheritedLabel && (
        <p className="text-xs text-muted-foreground pl-1">{showInheritedLabel}</p>
      )}

      {/* Empty state - only when not readOnly and no attachments */}
      {attachments.length === 0 && !readOnly && (
        <p className="text-xs text-muted-foreground">
          Add a receipt to support reconciliation
        </p>
      )}
    </div>
  );
}
