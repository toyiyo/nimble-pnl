import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useAssetImport } from '@/hooks/useAssetImport';
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  Loader2,
  FileImage,
  FileCode,
  ArrowUpFromLine
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getCSVTemplateHeader, getCSVTemplateSampleRow, suggestCategoryFromName } from '@/types/assetImport';
import { getDefaultUsefulLife } from '@/types/assets';
import type { AssetLineItem } from '@/types/assetImport';
import { AssetColumnMappingDialog } from './AssetColumnMappingDialog';
import { AssetImportMethodDialog, type ImportMethod } from './AssetImportMethodDialog';
import { suggestAssetColumnMappings, parseCSVLine } from '@/utils/assetColumnMapping';
import type { AssetColumnMapping } from '@/utils/assetColumnMapping';
import * as XLSX from 'xlsx';

interface AssetImportUploadProps {
  readonly onDocumentProcessed: (lineItems: AssetLineItem[], documentFile?: File) => void;
}

export function AssetImportUpload({ onDocumentProcessed }: Readonly<AssetImportUploadProps>) {
  const [processingStep, setProcessingStep] = useState<'idle' | 'upload' | 'process' | 'complete'>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // File input refs
  const documentInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // CSV mapping dialog state
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSampleData, setCsvSampleData] = useState<Record<string, string>[]>([]);
  const [csvAllRows, setCsvAllRows] = useState<Record<string, string>[]>([]);
  const [suggestedMappings, setSuggestedMappings] = useState<AssetColumnMapping[]>([]);
  const [pendingCsvFile, setPendingCsvFile] = useState<File | null>(null);

  // Import method choice dialog state
  const [showMethodDialog, setShowMethodDialog] = useState(false);
  const [pendingTextFile, setPendingTextFile] = useState<File | null>(null);

  const {
    uploadDocument,
    processDocument,
    lineItems,
    isUploading,
    isProcessing,
  } = useAssetImport();

  const { toast } = useToast();

  const resetCsvState = useCallback(() => {
    setPendingCsvFile(null);
    setCsvHeaders([]);
    setCsvSampleData([]);
    setCsvAllRows([]);
    setSuggestedMappings([]);
  }, []);

  const resetFileInputs = useCallback(() => {
    if (documentInputRef.current) documentInputRef.current.value = '';
    if (csvInputRef.current) csvInputRef.current.value = '';
  }, []);

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
          if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
          const headers = parseCSVLine(lines[0]).map(h => h.trim());
          const allRows: Record<string, string>[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const row: Record<string, string> = {};
            headers.forEach((header, index) => {
              row[header] = values[index]?.trim() || '';
            });
            allRows.push(row);
          }
          resolve({ headers, sampleData: allRows.slice(0, 5), allRows });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  const parseExcelForMapping = useCallback(async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, defval: '' }) as string[][];
    if (jsonData.length < 2) throw new Error('Excel file must have a header row and at least one data row');
    const headers = jsonData[0].map(h => String(h).trim());
    const allRows: Record<string, string>[] = [];
    for (let i = 1; i < jsonData.length; i++) {
      const rowData = jsonData[i];
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        const value = rowData[index];
        row[header] = value !== undefined ? String(value).trim() : '';
      });
      allRows.push(row);
    }
    return { headers, sampleData: allRows.slice(0, 5), allRows };
  }, []);

  const isTextBasedFile = useCallback((file: File): boolean => {
    const name = file.name.toLowerCase();
    return name.endsWith('.csv') || name.endsWith('.xls') || name.endsWith('.xlsx') ||
           name.endsWith('.xml') || name.endsWith('.txt') ||
           file.type === 'text/csv' || file.type === 'text/xml' || file.type === 'application/xml' ||
           file.type === 'application/vnd.ms-excel' ||
           file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }, []);

  const canUseColumnMapping = useCallback((file: File): boolean => {
    const name = file.name.toLowerCase();
    return name.endsWith('.csv') || name.endsWith('.xls') || name.endsWith('.xlsx') ||
           file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' ||
           file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }, []);

  const isExcelFile = useCallback((file: File): boolean => {
    const name = file.name.toLowerCase();
    return name.endsWith('.xls') || name.endsWith('.xlsx') ||
           file.type === 'application/vnd.ms-excel' ||
           file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }, []);

  const readFileAsText = useCallback(async (file: File): Promise<string> => {
    if (isExcelFile(file)) {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      return XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, [isExcelFile]);

  const handleAITextExtraction = useCallback(async (file: File) => {
    setProcessingStep('upload');
    setSelectedFile(file);
    try {
      const textContent = await readFileAsText(file);
      const document = await uploadDocument(file);
      if (!document) throw new Error('Failed to create document entry');
      setProcessingStep('process');
      const success = await processDocument(document, file, textContent);
      if (!success) throw new Error('AI extraction failed');
      setProcessingStep('complete');
    } catch (error) {
      console.error('AI text extraction error:', error);
      toast({ title: 'AI extraction failed', description: error instanceof Error ? error.message : 'Failed to extract assets', variant: 'destructive' });
      setProcessingStep('idle');
      resetFileInputs();
    }
  }, [readFileAsText, uploadDocument, processDocument, toast, resetFileInputs]);

  const convertMappedCSVToLineItems = useCallback((rows: Record<string, string>[], mappings: AssetColumnMapping[]): AssetLineItem[] => {
    const items: AssetLineItem[] = [];
    const fieldToColumn: Record<string, string> = {};
    mappings.forEach(m => { if (m.targetField && m.targetField !== 'ignore') fieldToColumn[m.targetField] = m.csvColumn; });

    rows.forEach((row) => {
      const name = fieldToColumn['name'] ? row[fieldToColumn['name']]?.trim() : '';
      if (!name) return;
      const purchaseCostStr = fieldToColumn['purchase_cost'] ? row[fieldToColumn['purchase_cost']]?.trim() : '';
      const purchaseCost = purchaseCostStr ? Number.parseFloat(purchaseCostStr.replaceAll(/[^0-9.-]/g, '')) || 0 : 0;
      const purchaseDateStr = fieldToColumn['purchase_date'] ? row[fieldToColumn['purchase_date']]?.trim() : '';
      const purchaseDate = purchaseDateStr || new Date().toISOString().split('T')[0];
      const csvCategory = fieldToColumn['category'] ? row[fieldToColumn['category']]?.trim() : '';
      const suggestion = suggestCategoryFromName(name);
      const category = csvCategory || suggestion.category;
      const usefulLifeStr = fieldToColumn['useful_life_months'] ? row[fieldToColumn['useful_life_months']]?.trim() : '';
      const usefulLifeMonths = usefulLifeStr ? parseInt(usefulLifeStr, 10) : getDefaultUsefulLife(category);
      const salvageStr = fieldToColumn['salvage_value'] ? row[fieldToColumn['salvage_value']]?.trim() : '';
      const salvageValue = salvageStr ? parseFloat(salvageStr.replace(/[^0-9.-]/g, '')) || 0 : 0;

      items.push({
        id: crypto.randomUUID(),
        rawText: name,
        parsedName: name,
        parsedDescription: fieldToColumn['description'] ? row[fieldToColumn['description']]?.trim() : undefined,
        purchaseCost,
        purchaseDate,
        serialNumber: fieldToColumn['serial_number'] ? row[fieldToColumn['serial_number']]?.trim() : undefined,
        suggestedCategory: category,
        suggestedUsefulLifeMonths: usefulLifeMonths,
        suggestedSalvageValue: salvageValue,
        confidenceScore: csvCategory ? 0.95 : suggestion.confidence,
        category,
        usefulLifeMonths,
        salvageValue,
        description: fieldToColumn['description'] ? row[fieldToColumn['description']]?.trim() : undefined,
        importStatus: 'pending',
      });
    });
    return items;
  }, []);

  const processFile = useCallback(async (file: File) => {
    setSelectedFile(file);
    if (isTextBasedFile(file)) {
      if (canUseColumnMapping(file)) {
        setPendingTextFile(file);
        setShowMethodDialog(true);
      } else {
        await handleAITextExtraction(file);
      }
      return;
    }
    setProcessingStep('upload');
    const document = await uploadDocument(file);
    if (!document) { setProcessingStep('idle'); resetFileInputs(); return; }
    setProcessingStep('process');
    const success = await processDocument(document, file);
    if (!success) { setProcessingStep('idle'); resetFileInputs(); return; }
    setProcessingStep('complete');
  }, [uploadDocument, processDocument, isTextBasedFile, canUseColumnMapping, handleAITextExtraction, resetFileInputs]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await processFile(file);
  }, [processFile]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  }, [processFile]);

  const handleMethodSelect = useCallback(async (method: ImportMethod) => {
    setShowMethodDialog(false);
    if (!pendingTextFile) { toast({ title: 'Error', description: 'No file selected.', variant: 'destructive' }); return; }
    const file = pendingTextFile;
    setPendingTextFile(null);
    if (method === 'ai') {
      await handleAITextExtraction(file);
    } else {
      try {
        const parsed = isExcelFile(file) ? await parseExcelForMapping(file) : await parseCSVForMapping(file);
        const mappings = suggestAssetColumnMappings(parsed.headers, parsed.sampleData);
        setCsvHeaders(parsed.headers);
        setCsvSampleData(parsed.sampleData);
        setCsvAllRows(parsed.allRows);
        setSuggestedMappings(mappings);
        setPendingCsvFile(file);
        setShowMappingDialog(true);
      } catch (error) {
        toast({ title: 'Parsing failed', description: error instanceof Error ? error.message : 'Failed to parse file', variant: 'destructive' });
        setProcessingStep('idle');
        resetFileInputs();
      }
    }
  }, [pendingTextFile, handleAITextExtraction, isExcelFile, parseExcelForMapping, parseCSVForMapping, toast, resetFileInputs]);

  const handleMappingConfirm = useCallback((mappings: AssetColumnMapping[]) => {
    setShowMappingDialog(false);
    if (csvAllRows.length === 0) { toast({ title: 'Error', description: 'No data found.', variant: 'destructive' }); return; }
    setProcessingStep('process');
    try {
      const items = convertMappedCSVToLineItems(csvAllRows, mappings);
      if (items.length === 0) throw new Error('No valid rows found');
      setProcessingStep('complete');
      toast({ title: 'File processed', description: `Found ${items.length} asset${items.length !== 1 ? 's' : ''}` });
      onDocumentProcessed(items, undefined);
    } catch (error) {
      toast({ title: 'Processing failed', description: error instanceof Error ? error.message : 'Failed to process file', variant: 'destructive' });
      setProcessingStep('idle');
    }
    resetCsvState();
    resetFileInputs();
  }, [csvAllRows, convertMappedCSVToLineItems, onDocumentProcessed, toast, resetCsvState, resetFileInputs]);

  useEffect(() => {
    const isColumnMappingFlow = showMappingDialog || csvAllRows.length > 0;
    if (processingStep === 'complete' && lineItems.length > 0 && selectedFile && !isColumnMappingFlow) {
      onDocumentProcessed(lineItems, selectedFile);
    }
  }, [processingStep, lineItems, selectedFile, showMappingDialog, csvAllRows, onDocumentProcessed]);

  const handleDownloadTemplate = useCallback(() => {
    const csvContent = [getCSVTemplateHeader(), getCSVTemplateSampleRow()].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asset-import-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast({ title: 'Template downloaded', description: 'Fill in your assets and upload' });
  }, [toast]);

  const isProcessingActive = isUploading || isProcessing;

  return (
    <div className="space-y-6">
      {/* Processing Status */}
      {processingStep !== 'idle' && (
        <div className={`rounded-xl p-4 border-2 transition-all ${
          processingStep === 'complete'
            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
            : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
        }`}>
          <div className="flex items-center gap-3 mb-3">
            {processingStep === 'complete' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            )}
            <span className="font-medium text-sm">
              {processingStep === 'upload' && 'Uploading document...'}
              {processingStep === 'process' && 'AI is extracting assets...'}
              {processingStep === 'complete' && 'Extraction complete!'}
            </span>
          </div>
          <Progress
            value={processingStep === 'upload' ? 35 : processingStep === 'process' ? 70 : 100}
            className="h-1.5"
          />
        </div>
      )}

      {/* Main Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
          dragActive
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 scale-[1.01]'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
        } ${isProcessingActive ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div className="p-8 sm:p-10">
          <div className="text-center">
            {/* Icon cluster */}
            <div className="relative inline-flex items-center justify-center mb-5">
              <div className="absolute -left-4 -top-1 p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30 rotate-[-8deg] shadow-sm">
                <FileCode className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20">
                <ArrowUpFromLine className="h-7 w-7 text-white" />
              </div>
              <div className="absolute -right-4 -bottom-1 p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 rotate-[8deg] shadow-sm">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
              Drop files here or click to upload
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Invoices, receipts, CSV, Excel, or XML files
            </p>

            {/* Upload buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <div className="relative">
                <Input
                  ref={documentInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                  onChange={handleFileUpload}
                  disabled={isProcessingActive}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Upload invoice or receipt"
                />
                <Button variant="default" className="pointer-events-none">
                  <FileImage className="h-4 w-4 mr-2" />
                  Invoice / Receipt
                </Button>
              </div>

              <div className="relative">
                <Input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,.xml,text/csv,text/xml,application/xml,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFileUpload}
                  disabled={isProcessingActive}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Upload spreadsheet or data file"
                />
                <Button variant="outline" className="pointer-events-none">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Spreadsheet
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* File Type Info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
          <div className="p-1.5 rounded bg-orange-100 dark:bg-orange-900/30">
            <FileText className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Documents</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">PDF, JPG, PNG</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
          <div className="p-1.5 rounded bg-emerald-100 dark:bg-emerald-900/30">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Spreadsheets</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">CSV, XLS, XLSX</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
          <div className="p-1.5 rounded bg-violet-100 dark:bg-violet-900/30">
            <FileCode className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Data Files</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">XML, TXT</p>
          </div>
        </div>
      </div>

      {/* Template Download */}
      <div className="flex items-center justify-between p-4 rounded-lg border bg-slate-50/50 dark:bg-slate-800/30">
        <div className="flex items-center gap-3">
          <Download className="h-5 w-5 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Need a template?</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Download our CSV format</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate} disabled={isProcessingActive}>
          Download Template
        </Button>
      </div>

      {/* Dialogs */}
      <AssetImportMethodDialog
        open={showMethodDialog}
        onClose={() => { setShowMethodDialog(false); setPendingTextFile(null); resetFileInputs(); }}
        onSelectMethod={handleMethodSelect}
        fileName={pendingTextFile?.name || ''}
      />
      <AssetColumnMappingDialog
        open={showMappingDialog}
        onOpenChange={(open) => {
          setShowMappingDialog(open);
          if (!open) { resetCsvState(); resetFileInputs(); setProcessingStep('idle'); }
        }}
        sampleData={csvSampleData}
        suggestedMappings={suggestedMappings}
        onConfirm={handleMappingConfirm}
      />
    </div>
  );
}
