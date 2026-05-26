import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, Camera } from 'lucide-react';
import { ImageCapture } from '@/components/ImageCapture';
import { DuplicateReceiptDialog } from '@/components/receipt/DuplicateReceiptDialog';
import { useReceiptImport } from '@/hooks/useReceiptImport';
import type { ReceiptImport, UploadResult } from '@/hooks/useReceiptImport';
import { useToast } from '@/components/ui/use-toast';

interface ReceiptUploadProps {
  onReceiptProcessed: (receiptId: string) => void;
}

export const ReceiptUpload: React.FC<ReceiptUploadProps> = ({ onReceiptProcessed }) => {
  const [uploadMethod, setUploadMethod] = useState<'file' | 'camera'>('file');
  const [processingStep, setProcessingStep] = useState<'upload' | 'process' | 'complete'>('upload');
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    file: File;
    existing: ReceiptImport;
  } | null>(null);
  const { uploadReceipt, processReceipt, isUploading, isProcessing } = useReceiptImport();
  const { toast } = useToast();
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await processReceiptFile(file);
    } finally {
      // Allow re-selecting the same file after a duplicate-dialog cancel.
      input.value = '';
    }
  };

  const handleImageCapture = async (imageBlob: Blob) => {
    const file = new File([imageBlob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await processReceiptFile(file);
  };

  const processReceiptFile = async (file: File, force = false) => {
    setProcessingStep('upload');

    const result: UploadResult | null = await uploadReceipt(file, { force });
    if (!result) return;

    if (result.kind === 'duplicate') {
      // Defer dialog mount one tick so the keypress that confirmed the file
      // picker (often Enter) settles before Radix's focus trap mounts.
      setTimeout(() => {
        if (mountedRef.current) {
          setPendingDuplicate({ file, existing: result.existing });
        }
      }, 0);
      return;
    }

    setProcessingStep('process');
    const processResult = await processReceipt(result.receipt.id, file);
    if (!processResult) return;

    setProcessingStep('complete');
    onReceiptProcessed(result.receipt.id);
    toast({
      title: "Receipt Ready",
      description: "Your receipt has been processed and is ready for review",
    });
  };

  const handleDuplicateCancel = () => {
    setPendingDuplicate(null);
    setProcessingStep('upload');
  };

  const handleDuplicateProceed = async () => {
    const pending = pendingDuplicate;
    setPendingDuplicate(null);
    if (!pending) return;
    await processReceiptFile(pending.file, true);
  };

  const getProgressValue = () => {
    switch (processingStep) {
      case 'upload': return isUploading ? 50 : 0;
      case 'process': return isProcessing ? 75 : 50;
      case 'complete': return 100;
      default: return 0;
    }
  };

  const getProgressText = () => {
    switch (processingStep) {
      case 'upload': return isUploading ? 'Uploading receipt...' : 'Ready to upload';
      case 'process': return isProcessing ? 'Processing with AI...' : 'Upload complete';
      case 'complete': return 'Processing complete!';
      default: return 'Ready';
    }
  };

  const isProcessingActive = isUploading || isProcessing;

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Upload Receipt
          </CardTitle>
          <CardDescription>
            Upload a receipt to automatically extract items and add them to your inventory
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isProcessingActive && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{getProgressText()}</span>
                <span>{getProgressValue()}%</span>
              </div>
              <Progress value={getProgressValue()} className="w-full" />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant={uploadMethod === 'file' ? 'default' : 'outline'}
              onClick={() => setUploadMethod('file')}
              className="flex-1"
              disabled={isProcessingActive}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </Button>
            <Button
              variant={uploadMethod === 'camera' ? 'default' : 'outline'}
              onClick={() => setUploadMethod('camera')}
              className="flex-1"
              disabled={isProcessingActive}
            >
              <Camera className="w-4 h-4 mr-2" />
              Take Photo
            </Button>
          </div>

          {uploadMethod === 'file' && (
            <div className="space-y-2">
              <Label htmlFor="receipt-file">Select Receipt Image</Label>
              <Input
                id="receipt-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                onChange={handleFileUpload}
                disabled={isProcessingActive}
                className="cursor-pointer"
              />
              <p className="text-sm text-muted-foreground">
                Supports JPG, PNG, WEBP images, and PDF files up to 10MB
              </p>
            </div>
          )}

          {uploadMethod === 'camera' && (
            <div className="space-y-2">
              <Label>Capture Receipt Photo</Label>
              <ImageCapture
                onImageCaptured={handleImageCapture}
                disabled={isProcessingActive}
                className="w-full"
              />
            </div>
          )}

          {isProcessingActive && (
            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">
                  {isUploading && 'Uploading your receipt...'}
                  {isProcessing && 'AI is reading your receipt...'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                This may take up to 30 seconds
              </p>
            </div>
          )}

          {processingStep === 'complete' && (
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium">Receipt processed successfully!</span>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Review the extracted items and map them to your inventory
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {pendingDuplicate && (
        <DuplicateReceiptDialog
          open={true}
          existing={pendingDuplicate.existing}
          onCancel={handleDuplicateCancel}
          onProceed={handleDuplicateProceed}
        />
      )}
    </>
  );
};
