import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Download, RotateCw, ZoomIn, ZoomOut, FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import type { Attachment } from './AttachmentThumbnail';

interface UsedByItem {
  type: 'expense' | 'bank_transaction';
  label: string;
  amount?: string;
  date?: string;
}

interface AttachmentViewerProps {
  attachment: Attachment | null;
  isOpen: boolean;
  onClose: () => void;
  usedBy?: UsedByItem[];
  onDownload?: (attachment: Attachment) => void;
}

export function AttachmentViewer({
  attachment,
  isOpen,
  onClose,
  usedBy = [],
  onDownload,
}: AttachmentViewerProps) {
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when attachment changes
  useEffect(() => {
    setRotation(0);
    setScale(1);
    setIsLoading(true);
  }, [attachment?.id]);

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleDownload = useCallback(() => {
    if (attachment && onDownload) {
      onDownload(attachment);
    } else if (attachment) {
      // Fallback: open in new tab
      window.open(attachment.fileUrl, '_blank');
    }
  }, [attachment, onDownload]);

  // Handle scroll zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.max(0.5, Math.min(3, prev + delta)));
  }, []);

  if (!attachment) return null;

  const isPdf = attachment.fileType === 'pdf';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-black/95 border-none overflow-hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>View {attachment.fileName}</DialogTitle>
        </VisuallyHidden>

        {/* Top toolbar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
          <div className="text-white/80 text-sm truncate max-w-[60%]">
            {attachment.fileName}
          </div>
          <div className="flex items-center gap-2">
            {!isPdf && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/80 hover:text-white hover:bg-white/10"
                  onClick={handleZoomOut}
                  aria-label="Zoom out"
                >
                  <ZoomOut className="h-5 w-5" />
                </Button>
                <span className="text-white/60 text-sm min-w-[3rem] text-center">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/80 hover:text-white hover:bg-white/10"
                  onClick={handleZoomIn}
                  aria-label="Zoom in"
                >
                  <ZoomIn className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/80 hover:text-white hover:bg-white/10"
                  onClick={handleRotate}
                  aria-label="Rotate"
                >
                  <RotateCw className="h-5 w-5" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={handleDownload}
              aria-label="Download"
            >
              <Download className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Main content area */}
        <div
          ref={containerRef}
          className="flex-1 flex items-center justify-center overflow-auto p-8 pt-16"
          onWheel={!isPdf ? handleWheel : undefined}
        >
          {isPdf ? (
            <div className="flex flex-col items-center gap-4 text-white/80">
              <FileText className="h-16 w-16" />
              <p className="text-lg">{attachment.fileName}</p>
              <Button
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
                onClick={handleDownload}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open PDF
              </Button>
            </div>
          ) : (
            <div
              className="relative transition-transform duration-200"
              style={{
                transform: `rotate(${rotation}deg) scale(${scale})`,
                transformOrigin: 'center center',
              }}
            >
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/30 border-t-white" />
                </div>
              )}
              <img
                src={attachment.fileUrl}
                alt={attachment.fileName}
                className={cn(
                  'max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl',
                  isLoading && 'opacity-0'
                )}
                onLoad={() => setIsLoading(false)}
                draggable={false}
              />
            </div>
          )}
        </div>

        {/* Bottom metadata bar */}
        {usedBy.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <div className="text-white/60 text-xs mb-2">Used by:</div>
            <div className="flex flex-wrap gap-2">
              {usedBy.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/80 text-sm"
                >
                  <span className="font-medium">{item.label}</span>
                  {item.amount && (
                    <span className="text-white/60">– {item.amount}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
