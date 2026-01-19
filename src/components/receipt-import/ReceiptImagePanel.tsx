import { useState, useEffect, useCallback } from 'react';
import { FileText, Image, Download, AlertCircle, RefreshCw, Expand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImageViewer } from '@/components/attachments/ImageViewer';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ReceiptImagePanelProps {
  fileUrl: string | null;
  fileName?: string | null;
  isPDF?: boolean;
  className?: string;
  onError?: () => void;
}

export function ReceiptImagePanel({
  fileUrl,
  fileName,
  isPDF = false,
  className,
  onError,
}: ReceiptImagePanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { toast } = useToast();

  // Reset error state when fileUrl changes
  useEffect(() => {
    setError(null);
  }, [fileUrl]);

  const handleDownload = useCallback(() => {
    if (!fileUrl) return;

    try {
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = fileName || 'receipt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download failed:', err);
      toast({
        title: 'Download failed',
        description: 'Unable to download the file.',
        variant: 'destructive',
      });
    }
  }, [fileUrl, fileName, toast]);

  const handleImageError = useCallback(() => {
    setError('Unable to load image');
    onError?.();
  }, [onError]);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    // Force re-render by toggling loading state
    setTimeout(() => setIsLoading(false), 100);
  }, []);

  if (!fileUrl) {
    return null;
  }

  return (
    <aside
      className={cn(
        'lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] flex flex-col',
        className
      )}
    >
      <Card className="flex-1 overflow-hidden flex flex-col border-border/50">
        <CardHeader className="shrink-0 pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            {isPDF ? (
              <FileText className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Image className="h-4 w-4 text-muted-foreground" />
            )}
            Receipt
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDownload}
              aria-label="Download receipt"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {/* Mobile collapse toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 lg:hidden"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? 'Expand preview' : 'Collapse preview'}
            >
              <Expand className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent
          className={cn(
            'flex-1 overflow-hidden p-3 pt-0 transition-all duration-200',
            isCollapsed && 'hidden lg:block'
          )}
        >
          {error ? (
            <div className="h-full min-h-[200px] border border-dashed rounded-lg flex flex-col items-center justify-center gap-3 p-4 text-center">
              <AlertCircle className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{error}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
              </div>
            </div>
          ) : isPDF ? (
            <div className="h-full min-h-[400px] lg:min-h-[500px] rounded-lg overflow-hidden border">
              <object
                data={fileUrl}
                type="application/pdf"
                className="w-full h-full"
                onError={() => setError('Unable to display PDF')}
              >
                <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    PDF preview not available
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    className="gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download PDF
                  </Button>
                </div>
              </object>
            </div>
          ) : (
            <ImageViewer
              src={fileUrl}
              alt={fileName || 'Receipt'}
              className="h-full min-h-[300px] lg:min-h-[400px]"
              showControls
              controlsPosition="overlay"
              onError={handleImageError}
              isLoading={isLoading}
            />
          )}
        </CardContent>

        {/* Mobile collapsed preview */}
        {isCollapsed && (
          <CardContent className="p-3 pt-0 lg:hidden">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setIsCollapsed(false)}
            >
              <Expand className="h-4 w-4" />
              View Receipt
            </Button>
          </CardContent>
        )}
      </Card>
    </aside>
  );
}
