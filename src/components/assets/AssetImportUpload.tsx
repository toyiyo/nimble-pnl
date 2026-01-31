import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useAssetImport } from '@/hooks/useAssetImport';
import { Upload, FileText, FileSpreadsheet, Download, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getCSVTemplateHeader, getCSVTemplateSampleRow, suggestCategoryFromName } from '@/types/assetImport';
import { getDefaultUsefulLife } from '@/types/assets';
import type { AssetLineItem } from '@/types/assetImport';
import { AssetColumnMappingDialog } from './AssetColumnMappingDialog';
import { suggestAssetColumnMappings, parseCSVLine } from '@/utils/assetColumnMapping';
import type { AssetColumnMapping } from '@/utils/assetColumnMapping';

interface AssetImportUploadProps {
  onDocumentProcessed: (lineItems: AssetLineItem[], documentFile?: File) => void;
}

export function AssetImportUpload({ onDocumentProcessed }: AssetImportUploadProps) {
  const [processingStep, setProcessingStep] = useState<'idle' | 'upload' | 'process' | 'complete'>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // CSV mapping dialog state
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSampleData, setCsvSampleData] = useState<Record<string, string>[]>([]);
  const [csvAllRows, setCsvAllRows] = useState<Record<string, string>[]>([]);
  const [suggestedMappings, setSuggestedMappings] = useState<AssetColumnMapping[]>([]);
  const [pendingCsvFile, setPendingCsvFile] = useState<File | null>(null);

  const {
    uploadDocument,
    processDocument,
    lineItems,
    isUploading,
    isProcessing,
  } = useAssetImport();

  const { toast } = useToast();

  /** Reset all CSV-related state */
  const resetCsvState = useCallback(() => {
    setPendingCsvFile(null);
    setCsvHeaders([]);
    setCsvSampleData([]);
    setCsvAllRows([]);
    setSuggestedMappings([]);
  }, []);

  /**
   * Parse CSV file and extract headers and sample data for mapping
   */
  const parseCSVForMapping = useCallback((file: File): Promise<{
    headers: string[];
    sampleData: Record<string, string>[];
    allRows: Record<string, string>[];
  }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split('\n').filter(line => line.trim());

          if (lines.length < 2) {
            throw new Error('CSV must have a header row and at least one data row');
          }

          // Parse header
          const headers = parseCSVLine(lines[0]).map(h => h.trim());

          // Parse all data rows
          const allRows: Record<string, string>[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const row: Record<string, string> = {};
            headers.forEach((header, index) => {
              row[header] = values[index]?.trim() || '';
            });
            allRows.push(row);
          }

          // Sample data for preview (first 5 rows)
          const sampleData = allRows.slice(0, 5);

          resolve({ headers, sampleData, allRows });
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsText(file);
    });
  }, []);

  /**
   * Convert mapped CSV data to AssetLineItems
   */
  const convertMappedCSVToLineItems = useCallback((
    rows: Record<string, string>[],
    mappings: AssetColumnMapping[]
  ): AssetLineItem[] => {
    const items: AssetLineItem[] = [];

    // Create a lookup from target field to CSV column
    const fieldToColumn: Record<string, string> = {};
    mappings.forEach(m => {
      if (m.targetField && m.targetField !== 'ignore') {
        fieldToColumn[m.targetField] = m.csvColumn;
      }
    });

    rows.forEach((row, index) => {
      // Get required values
      const nameColumn = fieldToColumn['name'];
      const dateColumn = fieldToColumn['purchase_date'];
      const costColumn = fieldToColumn['purchase_cost'];

      const name = nameColumn ? row[nameColumn]?.trim() : '';
      const purchaseDate = dateColumn ? row[dateColumn]?.trim() : '';
      const purchaseCostStr = costColumn ? row[costColumn]?.trim() : '';

      // Skip rows without required data
      if (!name || !purchaseDate || !purchaseCostStr) {
        console.warn(`Skipping row ${index + 1}: missing required fields`);
        return;
      }

      // Parse purchase cost (handle currency symbols)
      const purchaseCost = parseFloat(purchaseCostStr.replace(/[^0-9.-]/g, '')) || 0;

      // Get optional values
      const categoryColumn = fieldToColumn['category'];
      const csvCategory = categoryColumn ? row[categoryColumn]?.trim() : '';
      const suggestion = suggestCategoryFromName(name);
      const category = csvCategory || suggestion.category;

      const usefulLifeColumn = fieldToColumn['useful_life_months'];
      const usefulLifeStr = usefulLifeColumn ? row[usefulLifeColumn]?.trim() : '';
      const usefulLifeMonths = usefulLifeStr
        ? parseInt(usefulLifeStr, 10)
        : getDefaultUsefulLife(category);

      const salvageColumn = fieldToColumn['salvage_value'];
      const salvageStr = salvageColumn ? row[salvageColumn]?.trim() : '';
      const salvageValue = salvageStr
        ? parseFloat(salvageStr.replace(/[^0-9.-]/g, '')) || 0
        : 0;

      const serialColumn = fieldToColumn['serial_number'];
      const serialNumber = serialColumn ? row[serialColumn]?.trim() : undefined;

      const descColumn = fieldToColumn['description'];
      const description = descColumn ? row[descColumn]?.trim() : undefined;

      items.push({
        id: crypto.randomUUID(),
        rawText: name,
        parsedName: name,
        parsedDescription: description,
        purchaseCost,
        purchaseDate,
        serialNumber,
        suggestedCategory: category,
        suggestedUsefulLifeMonths: usefulLifeMonths,
        suggestedSalvageValue: salvageValue,
        confidenceScore: csvCategory ? 0.95 : suggestion.confidence,
        category,
        usefulLifeMonths,
        salvageValue,
        description,
        importStatus: 'pending',
      });
    });

    return items;
  }, []);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);

    // Check if it's a CSV file
    if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
      try {
        // Parse CSV for column mapping
        const { headers, sampleData, allRows } = await parseCSVForMapping(file);

        // Generate suggested mappings
        const mappings = suggestAssetColumnMappings(headers, sampleData);

        // Show mapping dialog for user to review/confirm mappings
        setCsvHeaders(headers);
        setCsvSampleData(sampleData);
        setCsvAllRows(allRows);
        setSuggestedMappings(mappings);
        setPendingCsvFile(file);
        setShowMappingDialog(true);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        toast({
          title: 'CSV parsing failed',
          description: error instanceof Error ? error.message : 'Failed to parse CSV file',
          variant: 'destructive',
        });
        setProcessingStep('idle');
      }
      return;
    }

    // For images and PDFs, use the full upload + AI process flow
    setProcessingStep('upload');

    const document = await uploadDocument(file);
    if (!document) {
      setProcessingStep('idle');
      return;
    }

    setProcessingStep('process');

    const success = await processDocument(document, file);
    if (!success) {
      setProcessingStep('idle');
      return;
    }

    setProcessingStep('complete');
    // Note: For PDF/image, onDocumentProcessed is called via useEffect below
    // because lineItems are updated async by the hook after processDocument completes
  }, [uploadDocument, processDocument, parseCSVForMapping, toast]);

  /**
   * Handle confirmed column mappings from dialog
   */
  const handleMappingConfirm = useCallback((mappings: AssetColumnMapping[]) => {
    setShowMappingDialog(false);

    if (csvAllRows.length === 0) {
      toast({
        title: 'Error',
        description: 'No CSV data found. Please try uploading again.',
        variant: 'destructive',
      });
      return;
    }

    setProcessingStep('process');

    try {
      const items = convertMappedCSVToLineItems(csvAllRows, mappings);

      if (items.length === 0) {
        throw new Error('No valid asset rows found in CSV');
      }

      setProcessingStep('complete');

      toast({
        title: 'CSV parsed',
        description: `Found ${items.length} asset${items.length !== 1 ? 's' : ''} in file`,
      });

      onDocumentProcessed(items, undefined); // No document to attach for CSV
    } catch (error) {
      console.error('Error processing CSV:', error);
      toast({
        title: 'CSV processing failed',
        description: error instanceof Error ? error.message : 'Failed to process CSV file',
        variant: 'destructive',
      });
      setProcessingStep('idle');
    }

    resetCsvState();
  }, [csvAllRows, convertMappedCSVToLineItems, onDocumentProcessed, toast, resetCsvState]);

  // Notify parent when PDF/image processing completes
  // CSV processing calls onDocumentProcessed directly since items are returned inline
  useEffect(() => {
    const isNonCsvFile = selectedFile && !selectedFile.name.toLowerCase().endsWith('.csv');
    if (processingStep === 'complete' && lineItems.length > 0 && isNonCsvFile) {
      onDocumentProcessed(lineItems, selectedFile);
    }
  }, [processingStep, lineItems, selectedFile, onDocumentProcessed]);

  const handleDownloadTemplate = useCallback(() => {
    const csvContent = [
      getCSVTemplateHeader(),
      getCSVTemplateSampleRow(),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asset-import-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Template downloaded',
      description: 'Fill in your assets and upload the completed CSV',
    });
  }, [toast]);

  const getProgressValue = () => {
    switch (processingStep) {
      case 'idle': return 0;
      case 'upload': return isUploading ? 40 : 20;
      case 'process': return isProcessing ? 70 : 50;
      case 'complete': return 100;
      default: return 0;
    }
  };

  const getProgressText = () => {
    switch (processingStep) {
      case 'idle': return 'Ready to upload';
      case 'upload': return isUploading ? 'Uploading document...' : 'Preparing upload...';
      case 'process': return isProcessing ? 'AI is extracting assets...' : 'Starting AI extraction...';
      case 'complete': return 'Extraction complete!';
      default: return 'Ready';
    }
  };

  const isProcessingActive = isUploading || isProcessing;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Import Assets
        </CardTitle>
        <CardDescription>
          Upload an invoice, receipt, or CSV file to automatically extract and import assets
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress indicator */}
        {processingStep !== 'idle' && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{getProgressText()}</span>
              <span>{getProgressValue()}%</span>
            </div>
            <Progress value={getProgressValue()} className="w-full" />
          </div>
        )}

        {/* File upload options */}
        <div className="grid gap-4">
          {/* Invoice/Receipt upload */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Upload Invoice or Receipt
            </Label>
            <Input
              id="asset-document"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
              onChange={handleFileUpload}
              disabled={isProcessingActive}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              AI will extract equipment and asset details from the document
            </p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                or import from spreadsheet
              </span>
            </div>
          </div>

          {/* CSV upload */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Upload CSV File
            </Label>
            <div className="flex gap-2">
              <Input
                id="asset-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                disabled={isProcessingActive}
                className="cursor-pointer flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleDownloadTemplate}
                disabled={isProcessingActive}
                title="Download CSV template"
                aria-label="Download CSV template"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Required columns: name, purchase_date, purchase_cost.
              <button
                onClick={handleDownloadTemplate}
                className="ml-1 text-primary hover:underline"
                disabled={isProcessingActive}
              >
                Download template
              </button>
            </p>
          </div>
        </div>

        {/* Processing status */}
        {isProcessingActive && (
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <span className="text-sm font-medium">
                {isUploading && 'Uploading your document...'}
                {isProcessing && 'AI is extracting assets from your document...'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              This may take up to 60 seconds for large documents
            </p>
          </div>
        )}

        {processingStep === 'complete' && (
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-sm font-medium">Document processed successfully!</span>
            </div>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              Review the extracted assets before importing
            </p>
          </div>
        )}

        {/* Help section */}
        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Supported Documents
          </h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• <strong>Invoices & Receipts:</strong> PDF, JPG, PNG (up to 10MB) - AI extracts asset details</li>
            <li>• <strong>Asset Lists:</strong> CSV with columns for name, purchase date, cost, and more</li>
            <li>• <strong>Equipment Schedules:</strong> PDF asset schedules or depreciation reports</li>
          </ul>
        </div>
      </CardContent>

      {/* Column Mapping Dialog for CSV */}
      <AssetColumnMappingDialog
        open={showMappingDialog}
        onOpenChange={(open) => {
          setShowMappingDialog(open);
          if (!open) {
            resetCsvState();
            setProcessingStep('idle');
          }
        }}
        csvHeaders={csvHeaders}
        sampleData={csvSampleData}
        suggestedMappings={suggestedMappings}
        onConfirm={handleMappingConfirm}
      />
    </Card>
  );
}
