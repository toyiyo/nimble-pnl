import { useState } from 'react';
import { FileText, X, Eye, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: 'image' | 'pdf';
  isInherited?: boolean;
  inheritedFrom?: string;
}

interface AttachmentThumbnailProps {
  attachment: Attachment;
  onView: (attachment: Attachment) => void;
  onRemove?: (attachmentId: string) => void;
  isLoading?: boolean;
  size?: 'sm' | 'md';
}

export function AttachmentThumbnail({
  attachment,
  onView,
  onRemove,
  isLoading = false,
  size = 'md',
}: AttachmentThumbnailProps) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const sizeClasses = {
    sm: 'h-12 w-12',
    md: 'h-16 w-16',
  };

  const isPdf = attachment.fileType === 'pdf';
  const showImage = !isPdf && !imageError;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'relative rounded-lg border border-border bg-muted/50 overflow-hidden cursor-pointer group transition-all duration-200',
              'hover:border-primary/30 hover:shadow-md',
              sizeClasses[size]
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => onView(attachment)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onView(attachment)}
            aria-label={`View ${attachment.fileName}`}
          >
            {/* Content */}
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : showImage ? (
              <img
                src={attachment.fileUrl}
                alt={attachment.fileName}
                className="h-full w-full object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
            )}

            {/* Hover overlay */}
            <div
              className={cn(
                'absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-200',
                isHovered ? 'opacity-100' : 'opacity-0'
              )}
            >
              <Eye className="h-4 w-4 text-white" />
            </div>

            {/* Remove button */}
            {onRemove && !attachment.isInherited && (
              <Button
                variant="destructive"
                size="icon"
                className={cn(
                  'absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full transition-opacity duration-200 shadow-sm',
                  isHovered ? 'opacity-100' : 'opacity-0'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(attachment.id);
                }}
                aria-label={`Remove ${attachment.fileName}`}
              >
                <X className="h-3 w-3" />
              </Button>
            )}

            {/* Inherited indicator */}
            {attachment.isInherited && (
              <div className="absolute bottom-0 left-0 right-0 bg-primary/80 py-0.5">
                <span className="text-[8px] text-primary-foreground font-medium block text-center truncate px-1">
                  Linked
                </span>
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <p className="text-xs truncate">{attachment.fileName}</p>
          {attachment.isInherited && attachment.inheritedFrom && (
            <p className="text-xs text-muted-foreground mt-0.5">
              From {attachment.inheritedFrom}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
