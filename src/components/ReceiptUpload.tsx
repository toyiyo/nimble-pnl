import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ImageCapture } from '@/components/ImageCapture';
import { useReceiptImport } from '@/hooks/useReceiptImport';
import { Upload, FileText, Camera } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface ReceiptUploadProps {
  onReceiptProcessed: (receiptId: string) => void;
}

export const ReceiptUpload: React.FC<ReceiptUploadProps> = ({ onReceiptProcessed }) => {
  const [uploadMethod, setUploadMethod] = useState<'file' | 'camera'>('file');
  const [processingStep, setProcessingStep] = useState<'upload' | 'process' | 'complete'>('upload');
  const { uploadReceipt, processReceipt, isUploading, isProcessing } = useReceiptImport();
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await processReceiptFile(file);
  };

  const handleImageCapture = async (imageBlob: Blob) => {
    const file = new File([imageBlob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await processReceiptFile(file);
  };

  const processReceiptFile = async (file: File) => {
    setProcessingStep('upload');
    
    // Upload the receipt
    const receiptData = await uploadReceipt(file);
    if (!receiptData) return;

    setProcessingStep('process');

    // Process the receipt with AI
    const processResult = await processReceipt(receiptData.id, file);
    if (!processResult) return;

    setProcessingStep('complete');
    
    // Notify parent component
    onReceiptProcessed(receiptData.id);
    
    toast({
      title: "Receipt Ready",
      description: "Your receipt has been processed and is ready for review",
    });
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
        {/* Progress indicator */}
        {isProcessingActive && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{getProgressText()}</span>
              <span>{getProgressValue()}%</span>
            </div>
            <Progress value={getProgressValue()} className="w-full" />
          </div>
        )}

        {/* Upload method selection */}
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

        {/* File upload */}
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

        {/* Camera capture */}
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

        {/* Processing status */}
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
  );
};