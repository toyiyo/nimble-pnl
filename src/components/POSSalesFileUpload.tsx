import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import Papa from 'papaparse';
import { ColumnMappingDialog, ColumnMapping } from './ColumnMappingDialog';
import { suggestColumnMappings, isSummaryRow } from '@/utils/csvColumnMapping';
import { extractDateFromFilename } from '@/utils/filenameDateExtraction';
import { loadMappingTemplates, findBestMatchingTemplate, applyTemplate } from '@/utils/mappingTemplates';

interface POSSalesFileUploadProps {
  onFileProcessed: (data: ParsedSale[]) => void;
}

export interface ParsedSale {
  itemName: string;
  quantity: number;
  totalPrice?: number;
  unitPrice?: number;
  saleDate: string;
  saleTime?: string;
  orderId?: string;
  category?: string;  // Added for Toast's "Sales Category"
  tags?: string;      // Added for Toast's "Item tags"
  adjustmentType?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee';
  isSummaryRow?: boolean;
  summaryRowReason?: string;
  rawData: Record<string, unknown>;
}

export const POSSalesFileUpload: React.FC<POSSalesFileUploadProps> = ({ onFileProcessed }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsingErrors, setParsingErrors] = useState<{ rowNumber: number; reason: string }[]>([]);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRawData, setCsvRawData] = useState<Record<string, string>[]>([]);
  const [suggestedMappings, setSuggestedMappings] = useState<ColumnMapping[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [detectedDate, setDetectedDate] = useState<{ date: Date; confidence: string } | null>(null);
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();

  const parseCSVWithMappings = (
    data: Record<string, string>[],
    mappings: ColumnMapping[]
  ): ParsedSale[] => {
    const skippedRows: { rowNumber: number; reason: string }[] = [];
    const parsedSales: ParsedSale[] = [];

    // Helper function to normalize numeric strings before parsing
    const normalizeNumericString = (value: string | undefined): string => {
      if (!value) return '';
      
      // Remove currency symbols, thousands separators, and trim
      let normalized = value.trim()
        .replace(/[$£€¥]/g, '')  // Remove currency symbols (all occurrences)
        .replace(/,/g, '');     // Remove thousands separators
      
      // Handle parentheses for negative values: (123.45) -> -123.45
      if (normalized.startsWith('(') && normalized.endsWith(')')) {
        normalized = '-' + normalized.substring(1, normalized.length - 1);
      }
      
      return normalized;
    };
    
    // Helper function to safely parse a numeric value with proper fallback
    const safeParseFloat = (value: string | undefined, fallback: number | undefined): number | undefined => {
      if (!value) return fallback;
      const normalized = normalizeNumericString(value);
      if (normalized === '') return fallback;
      
      const parsed = parseFloat(normalized);
      return isNaN(parsed) ? fallback : parsed;
    };

    // Get adjustment mappings once (used for determining gross vs net preference)
    const adjustmentMappings = mappings.filter(m => m.isAdjustment && m.adjustmentType);

    data.forEach((row, index) => {
      // Check if this is a summary row
      const summaryCheck = isSummaryRow(row);
      
      // Get mapped values
      const getMappedValue = (targetField: string): string | undefined => {
        const mapping = mappings.find(m => m.targetField === targetField);
        return mapping ? row[mapping.csvColumn] : undefined;
      };

      const itemName = getMappedValue('itemName') || '';
      
      // Skip rows with no item name unless it looks like a summary row
      if (!itemName && !summaryCheck.isSummary) {
        skippedRows.push({
          rowNumber: index + 1,
          reason: 'Missing item name',
        });
        return;
      }

      // Parse quantity - preserve 0 quantities, only use fallback for invalid/missing values
      const quantityStr = getMappedValue('quantity');
      const parsedQuantity = safeParseFloat(quantityStr, 1);
      const quantity = (parsedQuantity === null || parsedQuantity === undefined || isNaN(parsedQuantity)) ? 1 : parsedQuantity;

      // Parse prices - prefer gross sales over net sales when we have discount adjustments
      // This is because gross sales represents the transaction amount before discounts,
      // and discounts will be tracked separately as adjustment entries
      const netSales = safeParseFloat(getMappedValue('netSales'), undefined);
      const grossSales = safeParseFloat(getMappedValue('grossSales'), undefined);
      const totalPriceRaw = safeParseFloat(getMappedValue('totalPrice'), undefined);
      const unitPriceRaw = safeParseFloat(getMappedValue('unitPrice'), undefined);

      // Check if we have discount adjustments for this item
      const hasDiscountForItem = adjustmentMappings.some(m => m.adjustmentType === 'discount');

      // Determine the best total price
      // When discounts are tracked separately, use gross sales (before discount)
      const totalPrice = hasDiscountForItem 
        ? (grossSales ?? totalPriceRaw ?? netSales)
        : (netSales ?? totalPriceRaw ?? grossSales);
      const unitPrice = unitPriceRaw ?? (totalPrice !== undefined ? totalPrice / quantity : undefined);

      // Parse date and time
      let saleDate = getMappedValue('saleDate') || '';
      if (saleDate) {
        const dateObj = new Date(saleDate);
        if (!isNaN(dateObj.getTime())) {
          saleDate = dateObj.toISOString().split('T')[0];
        } else {
          saleDate = '';
        }
      }

      const saleTime = getMappedValue('saleTime');
      const orderId = getMappedValue('orderId');
      const category = getMappedValue('category');
      const department = getMappedValue('department');

      // Create the main sale record
      const baseSale: ParsedSale = {
        itemName: itemName.trim(),
        quantity,
        totalPrice,
        unitPrice,
        saleDate,
        saleTime: saleTime || undefined,
        orderId: orderId || `manual_upload_${Date.now()}_${index}`,
        category: category || department || undefined,
        isSummaryRow: summaryCheck.isSummary,
        summaryRowReason: summaryCheck.reason,
        rawData: {
          ...row,
          _parsedMeta: {
            posSystem: 'manual_upload',
            importedAt: new Date().toISOString(),
            rowIndex: index,
          }
        },
      };

      parsedSales.push(baseSale);

      // Process adjustment columns (discount, tax, tip, etc.)
      adjustmentMappings.forEach(adjMapping => {
        const adjValue = row[adjMapping.csvColumn];
        const adjAmount = safeParseFloat(adjValue, undefined);
        
        if (adjAmount && adjAmount !== 0) {
          // Create a separate adjustment entry
          const adjustmentName = `${itemName || 'Item'} - ${adjMapping.adjustmentType}`;
          
          parsedSales.push({
            itemName: adjustmentName,
            quantity: 1,
            // Discounts should be negative, others positive
            totalPrice: adjMapping.adjustmentType === 'discount' ? -Math.abs(adjAmount) : Math.abs(adjAmount),
            unitPrice: adjMapping.adjustmentType === 'discount' ? -Math.abs(adjAmount) : Math.abs(adjAmount),
            saleDate,
            saleTime: saleTime || undefined,
            orderId: orderId || `manual_upload_${Date.now()}_${index}_adj`,
            category: `Adjustment - ${adjMapping.adjustmentType}`,
            adjustmentType: adjMapping.adjustmentType,
            isSummaryRow: summaryCheck.isSummary,
            rawData: {
              ...row,
              _parsedMeta: {
                posSystem: 'manual_upload',
                importedAt: new Date().toISOString(),
                rowIndex: index,
                isAdjustment: true,
                parentItemName: itemName,
              }
            },
          });
        }
      });
    });

    if (skippedRows.length > 0) {
      setParsingErrors(skippedRows);
    }

    return parsedSales;
  };

  const parseCSVFile = async (file: File, mappings?: ColumnMapping[]): Promise<ParsedSale[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string, index: number) => {
          // Handle duplicate headers by appending index
          // Papa Parse will warn but we'll make it unique
          return header.trim() || `Column_${index}`;
        },
        complete: async (results) => {
          try {
            const data = results.data as Record<string, string>[];
            const headers = results.meta.fields || [];

            if (headers.length === 0 || data.length === 0) {
              reject(new Error('CSV file appears to be empty'));
              return;
            }
            
            // Check for any errors in parsing
            if (results.errors && results.errors.length > 0) {
              console.warn('CSV parsing warnings:', results.errors);
              // Only reject if there are fatal errors, not warnings
              const fatalErrors = results.errors.filter(err => err.type === 'Quotes' || err.type === 'FieldMismatch');
              if (fatalErrors.length > 0) {
                reject(new Error(`CSV parsing errors: ${fatalErrors.map(e => e.message).join(', ')}`));
                return;
              }
            }

            // If mappings provided, use them directly
            if (mappings) {
              const parsedSales = parseCSVWithMappings(data, mappings);
              resolve(parsedSales);
              return;
            }

            // Try to extract date from filename
            const extractedDate = extractDateFromFilename(file.name);
            if (extractedDate) {
              setDetectedDate({
                date: extractedDate.date,
                confidence: extractedDate.confidence,
              });
            } else {
              // Clear any stale date from previous uploads
              setDetectedDate(null);
            }

            // Try to load saved templates and find best match
            let finalMappings = suggestColumnMappings(headers, data.slice(0, 10));
            
            if (selectedRestaurant?.restaurant_id) {
              const { templates } = await loadMappingTemplates(selectedRestaurant.restaurant_id);
              const bestTemplate = findBestMatchingTemplate(headers, templates);
              
              if (bestTemplate) {
                // Apply the template
                finalMappings = applyTemplate(bestTemplate, headers);
                toast({
                  title: 'Template applied',
                  description: `Using saved mapping template: "${bestTemplate.template_name}"`,
                });
              }
            }
            
            // Always show mapping dialog to allow users to review and adjust mappings
            // This gives users control even when auto-mapping is confident
            setCsvHeaders(headers);
            setCsvRawData(data);
            setSuggestedMappings(finalMappings);
            setPendingFile(file);
            setShowMappingDialog(true);
            
            // Don't resolve yet - wait for user to confirm mappings
            reject(new Error('PENDING_MAPPING'));
          } catch (error) {
            reject(error);
          }
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  };

  const handleMappingConfirm = async (confirmedMappings: ColumnMapping[], templateName?: string) => {
    setShowMappingDialog(false);
    setIsProcessing(true);

    try {
      if (!pendingFile) {
        throw new Error('No file available');
      }

      // Save template if requested
      if (templateName && selectedRestaurant?.restaurant_id) {
        const { saveMappingTemplate } = await import('@/utils/mappingTemplates');
        const result = await saveMappingTemplate(
          selectedRestaurant.restaurant_id,
          templateName,
          csvHeaders,
          confirmedMappings
        );
        
        if (result.success) {
          toast({
            title: 'Template saved',
            description: `Mapping template "${templateName}" has been saved for future use`,
          });
        } else {
          toast({
            title: 'Template save failed',
            description: result.error || 'Failed to save template',
            variant: 'destructive',
          });
        }
      }

      const parsedSales = await parseCSVFile(pendingFile, confirmedMappings);
      
      if (parsedSales.length === 0) {
        toast({
          title: "No data found",
          description: "The CSV file appears to be empty after filtering",
          variant: "destructive",
        });
        return;
      }

      // If we detected a date from the filename, set it on all rows that don't have dates
      if (detectedDate) {
        const dateStr = detectedDate.date.toISOString().split('T')[0];
        parsedSales.forEach(sale => {
          if (!sale.saleDate) {
            sale.saleDate = dateStr;
          }
        });
      }

      // Check if any rows are missing dates (after filename date application)
      const rowsMissingDates = parsedSales.some(sale => !sale.saleDate);
      if (rowsMissingDates) {
        // Set a flag on the array to indicate date input is needed
        (parsedSales as any).needsDateInput = true;
      }

      // Check for summary rows
      const hasSummaryRows = parsedSales.some(sale => sale.isSummaryRow);
      if (hasSummaryRows) {
        toast({
          title: 'Summary rows detected',
          description: 'Some rows appear to be totals or summaries. They are highlighted in the review screen.',
        });
      }

      toast({
        title: "File processed",
        description: `Successfully parsed ${parsedSales.length} records`,
      });

      onFileProcessed(parsedSales);
    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: "Error processing file",
        description: error instanceof Error ? error.message : "Failed to parse CSV file",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setPendingFile(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setParsingErrors([]); // Clear previous errors

    try {
      const parsedSales = await parseCSVFile(file);
      
      if (parsedSales.length === 0) {
        toast({
          title: "No data found",
          description: "The CSV file appears to be empty",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "File processed",
        description: `Successfully parsed ${parsedSales.length} records`,
      });

      onFileProcessed(parsedSales);
    } catch (error) {
      // Special case: mapping dialog is being shown, don't show error
      if (error instanceof Error && error.message === 'PENDING_MAPPING') {
        toast({
          title: "Review column mappings",
          description: "Please confirm how your CSV columns map to our fields",
        });
        return;
      }

      console.error('Error processing file:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to parse CSV file";
      toast({
        title: "Error processing file",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      // Reset file input
      event.target.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload POS Sales File</CardTitle>
        <CardDescription>
          Import sales data from a CSV file exported from your POS system (TOAST, Square, etc.)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {parsingErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <div className="ml-2">
              <h4 className="font-semibold mb-2">Skipped {parsingErrors.length} row{parsingErrors.length !== 1 ? 's' : ''} during import</h4>
              <div className="text-sm space-y-1">
                <p className="mb-2">The following rows could not be imported:</p>
                <ul className="list-disc list-inside space-y-1 max-h-40 overflow-y-auto">
                  {parsingErrors.map((error, idx) => (
                    <li key={idx}>
                      <span className="font-medium">Row {error.rowNumber}:</span> {error.reason}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 pt-3 border-t border-destructive/20">
                  <p className="font-medium">How to fix:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Ensure all rows have an item name in the 'Item', 'Product', or 'Name' column</li>
                    <li>Check that date columns contain valid dates (if your CSV has date columns)</li>
                    <li>Remove or fix empty rows in your CSV file</li>
                    <li>If using TOAST POS exports, ensure you're using the detailed item report</li>
                  </ul>
                </div>
              </div>
            </div>
          </Alert>
        )}
        <div className="border-2 border-dashed rounded-lg p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <div>
              <Label htmlFor="file-upload" className="cursor-pointer">
                <Button asChild variant="outline" disabled={isProcessing}>
                  <span>
                    <FileText className="w-4 h-4 mr-2" />
                    {isProcessing ? 'Processing...' : 'Choose CSV File'}
                  </span>
                </Button>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={isProcessing}
                />
              </Label>
              <p className="text-sm text-muted-foreground mt-2">
                Supports CSV files from TOAST, Square, and other POS systems
              </p>
            </div>
          </div>
        </div>

        <div className="bg-muted p-4 rounded-lg space-y-2">
          <h4 className="text-sm font-semibold">Expected CSV Format:</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Required: Item name column</li>
            <li>• Recommended: Date, Quantity, Price/Amount, Time, Order ID</li>
            <li>• Files without dates will prompt you to enter a date during review</li>
            <li>• Column names are case-insensitive and flexible</li>
            <li>• <strong>Automatic adjustment detection</strong>: Columns with discounts, taxes, and tips create separate entries</li>
            <li>• Summary rows (like "Totals:") are automatically detected and excluded</li>
            <li>• Duplicate transactions are automatically detected and prevented</li>
          </ul>
        </div>
      </CardContent>

      <ColumnMappingDialog
        open={showMappingDialog}
        onOpenChange={setShowMappingDialog}
        csvHeaders={csvHeaders}
        sampleData={csvRawData.slice(0, 10)}
        suggestedMappings={suggestedMappings}
        onConfirm={handleMappingConfirm}
        detectedDate={detectedDate}
        restaurantId={selectedRestaurant?.restaurant_id}
      />
    </Card>
  );
};
