import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useBankStatementImport } from '@/hooks/useBankStatementImport';
import { Upload, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface BankStatementUploadProps {
  onStatementProcessed: (statementId: string) => void;
}

export const BankStatementUpload: React.FC<BankStatementUploadProps> = ({ onStatementProcessed }) => {
  const [processingStep, setProcessingStep] = useState<'upload' | 'process' | 'complete'>('upload');
  const { uploadBankStatement, processBankStatement, isUploading, isProcessing } = useBankStatementImport();
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await processStatementFile(file);
  };

  const processStatementFile = async (file: File) => {
    setProcessingStep('upload');
    
    // Upload the statement
    const statementData = await uploadBankStatement(file);
    if (!statementData) return;

    setProcessingStep('process');

    // Process the statement with AI
    const processResult = await processBankStatement(statementData.id);
    if (!processResult) return;

    setProcessingStep('complete');
    
    // Notify parent component
    onStatementProcessed(statementData.id);
    
    toast({
      title: "Statement Ready",
      description: "Your bank statement has been processed and is ready for review",
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
      case 'upload': return isUploading ? 'Uploading statement...' : 'Ready to upload';
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
          Upload Bank Statement
        </CardTitle>
        <CardDescription>
          Upload a PDF bank statement to automatically import transactions to your banking records
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

        {/* File upload */}
        <div className="space-y-2">
          <Label htmlFor="statement-file">Select Bank Statement PDF</Label>
          <Input
            id="statement-file"
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            disabled={isProcessingActive}
            className="cursor-pointer"
          />
          <p className="text-sm text-muted-foreground">
            Supports PDF files only, up to 5MB. For larger files, please split into multiple statements.
          </p>
        </div>

        {/* Processing status */}
        {isProcessingActive && (
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">
                {isUploading && 'Uploading your bank statement...'}
                {isProcessing && 'AI is reading your statement...'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              This may take up to 90 seconds for larger files
            </p>
          </div>
        )}

        {processingStep === 'complete' && (
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm font-medium">Statement processed successfully!</span>
            </div>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              Review the extracted transactions and import them to your records
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
