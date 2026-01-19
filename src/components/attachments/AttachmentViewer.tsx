import { useState, useCallback, useEffect } from 'react';
import { X, Download, AlertCircle, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ImageViewer } from './ImageViewer';
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
  const [isLoading, setIsLoading] = useState(true);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const { toast } = useToast();

  // Reset state when attachment changes
  useEffect(() => {
    setIsLoading(true);
    setPdfBlobUrl(null);
    setPdfError(null);
  }, [attachment?.id]);

  // Load PDF as blob to bypass domain blocking
  useEffect(() => {
    if (!attachment || attachment.fileType !== 'pdf' || !isOpen) return;

    let cancelled = false;

    const loadPdfBlob = async () => {
      setIsLoading(true);
      setPdfError(null);

      try {
        const { data, error } = await supabase.storage
          .from('receipt-images')
          .download(attachment.storagePath);

        if (cancelled) return;

        if (error || !data) {
          throw new Error('Failed to load PDF');
        }

        const blobUrl = URL.createObjectURL(data);
        setPdfBlobUrl(blobUrl);
        setIsLoading(false);
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading PDF:', error);
        setPdfError('Unable to load PDF. The file may be blocked by your browser or network.');
        setIsLoading(false);
      }
    };

    loadPdfBlob();

    return () => {
      cancelled = true;
    };
  }, [attachment?.id, attachment?.storagePath, attachment?.fileType, isOpen]);

  // Clean up blob URL when dialog closes
  useEffect(() => {
    if (!isOpen && pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
  }, [isOpen, pdfBlobUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, []);

  const handleDownload = useCallback(async () => {
    if (!attachment) return;

    if (onDownload) {
      onDownload(attachment);
      return;
    }

    // Fallback: blob-based download
    try {
      const { data, error } = await supabase.storage
        .from('receipt-images')
        .download(attachment.storagePath);

      if (error || !data) {
        throw new Error('Failed to download');
      }

      const blobUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: 'Download failed',
        description: 'Unable to download the file.',
        variant: 'destructive',
      });
    }
  }, [attachment, onDownload, toast]);

  const handleCopyLink = useCallback(() => {
    if (attachment?.fileUrl) {
      navigator.clipboard.writeText(attachment.fileUrl);
      toast({
        title: 'Link copied',
        description: 'Secure link copied to clipboard.',
      });
    }
  }, [attachment?.fileUrl, toast]);

  const handleRetry = useCallback(() => {
    if (attachment) {
      setIsLoading(true);
      setPdfError(null);
      setPdfBlobUrl(null);
      const load = async () => {
        try {
          const { data, error } = await supabase.storage
            .from('receipt-images')
            .download(attachment.storagePath);

          if (error || !data) {
            throw new Error('Failed to load PDF');
          }

          const blobUrl = URL.createObjectURL(data);
          setPdfBlobUrl(blobUrl);
          setIsLoading(false);
        } catch (error) {
          console.error('Error loading PDF:', error);
          setPdfError('Unable to load PDF. The file may be blocked by your browser or network.');
          setIsLoading(false);
        }
      };
      load();
    }
  }, [attachment]);

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
        <div className="flex-1 flex items-center justify-center overflow-auto p-8 pt-16">
          {isPdf ? (
            <div className="w-full h-full flex flex-col items-center justify-center">
              {isLoading && (
                <div className="flex flex-col items-center justify-center gap-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/30 border-t-white" />
                  <p className="text-white/60 text-sm">Loading PDF...</p>
                </div>
              )}
              
              {pdfError && (
                <div className="flex flex-col items-center justify-center gap-4 max-w-md text-center p-6 rounded-lg bg-white/5 border border-white/10">
                  <AlertCircle className="h-12 w-12 text-amber-400" />
                  <div>
                    <h3 className="text-white text-lg font-medium mb-2">Unable to display PDF</h3>
                    <p className="text-white/60 text-sm mb-4">{pdfError}</p>
                    <p className="text-white/40 text-xs">
                      This may be caused by an ad blocker or network policy blocking access.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/20 text-white hover:bg-white/10"
                      onClick={handleRetry}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/20 text-white hover:bg-white/10"
                      onClick={handleDownload}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/20 text-white hover:bg-white/10"
                      onClick={handleCopyLink}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Link
                    </Button>
                  </div>
                </div>
              )}
              
              {pdfBlobUrl && !pdfError && (
                <iframe
                  src={`${pdfBlobUrl}#toolbar=1&navpanes=0`}
                  className="w-full h-[calc(100vh-120px)] rounded-lg bg-white"
                  title={attachment.fileName}
                />
              )}
            </div>
          ) : (
            <div className="w-full h-full max-w-4xl max-h-[80vh]">
              <ImageViewer
                src={attachment.fileUrl}
                alt={attachment.fileName}
                className="w-full h-full"
                showControls
                controlsPosition="overlay"
                onError={() => {
                  toast({
                    title: 'Failed to load image',
                    description: 'The image could not be displayed.',
                    variant: 'destructive',
                  });
                }}
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
