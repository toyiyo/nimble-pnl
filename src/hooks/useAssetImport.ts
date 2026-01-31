import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAssets } from '@/hooks/useAssets';
import type {
  AssetLineItem,
  AssetImportDocument,
  AssetExtractionResponse,
  AssetImportResult,
  AssetCSVRow,
} from '@/types/assetImport';
import { createAssetLineItem, parseCSVRowToLineItem, REQUIRED_CSV_COLUMNS } from '@/types/assetImport';


export interface UseAssetImportReturn {
  // State
  isUploading: boolean;
  isProcessing: boolean;
  isImporting: boolean;
  currentDocument: AssetImportDocument | null;
  lineItems: AssetLineItem[];
  importProgress: { current: number; total: number } | null;

  // Actions
  uploadDocument: (file: File) => Promise<AssetImportDocument | null>;
  processDocument: (document: AssetImportDocument, file: Blob) => Promise<boolean>;
  parseCSV: (file: File) => Promise<AssetLineItem[]>;
  updateLineItem: (id: string, updates: Partial<AssetLineItem>) => void;
  removeLineItem: (id: string) => void;
  bulkImportAssets: (items: AssetLineItem[], documentFile?: File) => Promise<AssetImportResult>;
  reset: () => void;
}

export function useAssetImport(): UseAssetImportReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<AssetImportDocument | null>(null);
  const [lineItems, setLineItems] = useState<AssetLineItem[]>([]);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);

  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();
  const { createAssetAsync } = useAssets();

  /**
   * Upload a document (PDF, image, or CSV) to storage
   */
  const uploadDocument = useCallback(async (file: File): Promise<AssetImportDocument | null> => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: 'Error',
        description: 'Please select a restaurant first',
        variant: 'destructive',
      });
      return null;
    }

    setIsUploading(true);
    try {
      // Sanitize filename
      const fileExt = file.name.split('.').pop();
      const sanitizedBaseName = file.name
        .replace(`.${fileExt}`, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const finalFileName = `${Date.now()}-${sanitizedBaseName}.${fileExt}`;
      const filePath = `${selectedRestaurant.restaurant_id}/asset-imports/${finalFileName}`;

      // Upload to asset-images bucket (reuse existing bucket)
      const { error: uploadError } = await supabase.storage
        .from('asset-images')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const document: AssetImportDocument = {
        id: crypto.randomUUID(),
        restaurantId: selectedRestaurant.restaurant_id,
        fileName: file.name,
        filePath,
        fileSize: file.size,
        mimeType: file.type,
        status: 'uploading',
      };

      setCurrentDocument(document);

      toast({
        title: 'Upload complete',
        description: 'Document uploaded. Processing...',
      });

      return document;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload document. Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [selectedRestaurant, toast]);

  /**
   * Process a document with AI to extract assets
   */
  const processDocument = useCallback(async (
    document: AssetImportDocument,
    fileBlob: Blob
  ): Promise<boolean> => {
    setIsProcessing(true);
    setCurrentDocument({ ...document, status: 'processing' });

    try {
      console.log('Processing asset document:', document.fileName, 'type:', fileBlob.type);

      const isPDF = fileBlob.type === 'application/pdf';
      let dataToSend: string;

      if (isPDF) {
        // Generate signed URL for PDF
        const { data: signedUrlData, error: signedUrlError } = await supabase
          .storage
          .from('asset-images')
          .createSignedUrl(document.filePath, 3600);

        if (signedUrlError || !signedUrlData?.signedUrl) {
          throw new Error('Failed to generate signed URL for PDF');
        }

        dataToSend = signedUrlData.signedUrl;
      } else {
        // Convert image to base64
        dataToSend = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(fileBlob);
        });
      }

      // Call the edge function with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

      try {
        const { data, error } = await supabase.functions.invoke('process-asset-document', {
          body: {
            documentId: document.id,
            imageData: dataToSend,
            isPDF,
            restaurantId: document.restaurantId,
          },
          // @ts-expect-error - signal option is supported but not in types yet
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (error) {
          throw error;
        }

        const response = data as AssetExtractionResponse;

        if (!response.success || !response.lineItems?.length) {
          throw new Error(response.error || 'No assets found in document');
        }

        // Convert extracted items to AssetLineItems
        const items = response.lineItems.map(item =>
          createAssetLineItem(item, response.purchaseDate)
        );

        setLineItems(items);
        setCurrentDocument({
          ...document,
          status: 'processed',
          vendor: response.vendor,
          purchaseDate: response.purchaseDate,
          totalAmount: response.totalAmount,
          processedAt: new Date().toISOString(),
        });

        toast({
          title: 'Processing complete',
          description: `Found ${items.length} asset${items.length !== 1 ? 's' : ''} in document`,
        });

        return true;
      } catch (error: unknown) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Processing timed out. Please try a smaller document.');
        }
        throw error;
      }
    } catch (error) {
      console.error('Error processing document:', error);
      setCurrentDocument({
        ...document,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Processing failed',
      });
      toast({
        title: 'Processing failed',
        description: error instanceof Error ? error.message : 'Failed to extract assets from document',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [toast]);

  /**
   * Parse a CSV file to extract assets (client-side, no AI needed)
   */
  const parseCSV = useCallback(async (file: File): Promise<AssetLineItem[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split('\n').filter(line => line.trim());

          if (lines.length < 2) {
            throw new Error('CSV must have a header row and at least one data row');
          }

          // Parse header (use robust CSV parser to handle quoted values)
          const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replaceAll(/\s+/g, '_'));

          // Check for required columns
          const missingColumns = REQUIRED_CSV_COLUMNS.filter(col => !header.includes(col));
          if (missingColumns.length > 0) {
            throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
          }

          // Parse data rows
          const items: AssetLineItem[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length === 0) continue;

            const row: AssetCSVRow = {
              name: '',
              purchase_date: '',
              purchase_cost: 0,
            };

            header.forEach((col, index) => {
              const value = values[index]?.trim() || '';
              switch (col) {
                case 'name':
                  row.name = value;
                  break;
                case 'category':
                  row.category = value;
                  break;
                case 'purchase_date':
                  row.purchase_date = value;
                  break;
                case 'purchase_cost':
                  row.purchase_cost = value;
                  break;
                case 'salvage_value':
                  row.salvage_value = value;
                  break;
                case 'useful_life_months':
                  row.useful_life_months = value;
                  break;
                case 'serial_number':
                  row.serial_number = value;
                  break;
                case 'description':
                  row.description = value;
                  break;
                case 'location':
                  row.location = value;
                  break;
              }
            });

            // Skip rows without required data
            if (!row.name || !row.purchase_date || !row.purchase_cost) {
              console.warn(`Skipping row ${i + 1}: missing required fields`);
              continue;
            }

            items.push(parseCSVRowToLineItem(row));
          }

          if (items.length === 0) {
            throw new Error('No valid asset rows found in CSV');
          }

          setLineItems(items);
          setCurrentDocument({
            id: crypto.randomUUID(),
            restaurantId: selectedRestaurant?.restaurant_id || '',
            fileName: file.name,
            filePath: '',
            fileSize: file.size,
            mimeType: 'text/csv',
            status: 'processed',
            processedAt: new Date().toISOString(),
          });

          toast({
            title: 'CSV parsed',
            description: `Found ${items.length} asset${items.length !== 1 ? 's' : ''} in file`,
          });

          resolve(items);
        } catch (error) {
          console.error('Error parsing CSV:', error);
          toast({
            title: 'CSV parsing failed',
            description: error instanceof Error ? error.message : 'Failed to parse CSV file',
            variant: 'destructive',
          });
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsText(file);
    });
  }, [selectedRestaurant, toast]);

  /**
   * Update a line item
   */
  const updateLineItem = useCallback((id: string, updates: Partial<AssetLineItem>) => {
    setLineItems(prev =>
      prev.map(item => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  /**
   * Remove a line item
   */
  const removeLineItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
  }, []);

  /**
   * Bulk import assets to the database
   */
  const bulkImportAssets = useCallback(async (
    items: AssetLineItem[],
    documentFile?: File
  ): Promise<AssetImportResult> => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: 'Error',
        description: 'Please select a restaurant first',
        variant: 'destructive',
      });
      return { success: false, totalItems: items.length, importedCount: 0, failedCount: items.length, errors: [] };
    }

    setIsImporting(true);
    setImportProgress({ current: 0, total: items.length });

    const result: AssetImportResult = {
      success: false,
      totalItems: items.length,
      importedCount: 0,
      failedCount: 0,
      errors: [],
    };

    // Upload document once if provided (to attach to all assets)
    let documentStoragePath: string | null = null;
    if (documentFile) {
      try {
        const fileExt = documentFile.name.split('.').pop();
        const sanitizedBaseName = documentFile.name
          .replace(`.${fileExt}`, '')
          .replace(/[^a-zA-Z0-9_-]/g, '_');
        const finalFileName = `${Date.now()}-${sanitizedBaseName}.${fileExt}`;
        documentStoragePath = `${selectedRestaurant.restaurant_id}/assets/imports/${finalFileName}`;

        const { error: uploadError } = await supabase.storage
          .from('asset-images')
          .upload(documentStoragePath, documentFile);

        if (uploadError) {
          console.error('Failed to upload document for attachment:', uploadError);
          documentStoragePath = null;
          toast({
            title: 'Warning',
            description: 'Could not attach document to assets. Assets will be imported without the invoice/receipt.',
            variant: 'default',
          });
        }
      } catch (error) {
        console.error('Error uploading document:', error);
        documentStoragePath = null;
        toast({
          title: 'Warning',
          description: 'Could not attach document to assets. Assets will be imported without the invoice/receipt.',
          variant: 'default',
        });
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setImportProgress({ current: i + 1, total: items.length });

      try {
        // Update item status
        setLineItems(prev =>
          prev.map(li => (li.id === item.id ? { ...li, importStatus: 'importing' } : li))
        );

        // Create the asset
        const asset = await createAssetAsync({
          name: item.parsedName,
          description: item.description || item.parsedDescription,
          category: item.category,
          serial_number: item.serialNumber,
          purchase_date: item.purchaseDate,
          purchase_cost: item.purchaseCost,
          salvage_value: item.salvageValue,
          useful_life_months: item.usefulLifeMonths,
          location_id: item.locationId,
        });

        // Attach document as photo if we have it
        if (documentStoragePath && asset) {
          await supabase
            .from('asset_photos')
            .insert({
              asset_id: asset.id,
              restaurant_id: selectedRestaurant.restaurant_id,
              storage_path: documentStoragePath,
              file_name: documentFile?.name || 'Import Document',
              file_size: documentFile?.size || 0,
              mime_type: documentFile?.type || 'application/octet-stream',
              is_primary: true,
            });
        }

        result.importedCount++;

        // Update item status to imported
        setLineItems(prev =>
          prev.map(li => (li.id === item.id ? { ...li, importStatus: 'imported' } : li))
        );
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          itemName: item.parsedName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Update item status to error
        setLineItems(prev =>
          prev.map(li =>
            li.id === item.id
              ? { ...li, importStatus: 'error', errorMessage: error instanceof Error ? error.message : 'Import failed' }
              : li
          )
        );
      }
    }

    result.success = result.importedCount > 0;
    setImportProgress(null);
    setIsImporting(false);

    if (result.success) {
      if (result.failedCount > 0) {
        toast({
          title: 'Partial import',
          description: `Imported ${result.importedCount} of ${result.totalItems} assets. ${result.failedCount} failed.`,
          variant: 'default',
        });
      } else {
        toast({
          title: 'Import complete',
          description: `Successfully imported ${result.importedCount} asset${result.importedCount !== 1 ? 's' : ''}`,
        });
      }
    } else {
      toast({
        title: 'Import failed',
        description: 'No assets were imported. Please check the errors and try again.',
        variant: 'destructive',
      });
    }

    return result;
  }, [selectedRestaurant, createAssetAsync, toast]);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setCurrentDocument(null);
    setLineItems([]);
    setIsUploading(false);
    setIsProcessing(false);
    setIsImporting(false);
    setImportProgress(null);
  }, []);

  return {
    isUploading,
    isProcessing,
    isImporting,
    currentDocument,
    lineItems,
    importProgress,
    uploadDocument,
    processDocument,
    parseCSV,
    updateLineItem,
    removeLineItem,
    bulkImportAssets,
    reset,
  };
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
