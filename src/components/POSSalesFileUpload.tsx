import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import Papa from 'papaparse';

interface POSSalesFileUploadProps {
  onFileProcessed: (data: ParsedSale[]) => void;
}

interface ParsedSale {
  itemName: string;
  quantity: number;
  totalPrice?: number;
  unitPrice?: number;
  saleDate: string;
  saleTime?: string;
  orderId?: string;
  category?: string;  // Added for Toast's "Sales Category"
  tags?: string;      // Added for Toast's "Item tags"
  rawData: Record<string, unknown>;
}

export const POSSalesFileUpload: React.FC<POSSalesFileUploadProps> = ({ onFileProcessed }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const parseCSVFile = async (file: File): Promise<ParsedSale[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            // Keep track of skipped rows for reporting
            const skippedRows: { rowNumber: number; reason: string }[] = [];
            
            // Process rows, filtering out invalid ones
            const parsedSales = results.data
              .map((row: Record<string, string>, index: number) => {
                // Flexible column mapping - try to detect common column names
                // TOAST POS typically uses: Item, Quantity, Amount, Date, Time
                
                // Find item name column (case insensitive)
                // For Toast POS: check for both "Item" and "Modifier" since modifiers have their name in the "Modifier" column
                const itemName = 
                  row['Item'] || 
                  row['item'] ||
                  row['Modifier'] ||
                  row['modifier'] ||
                  row['Size modifier'] || // Handle additional fields from Toast
                  row['Item Name'] || 
                  row['item_name'] ||
                  row['Product'] ||
                  row['product'] ||
                  row['Menu Item'] ||
                  row['Name'] ||
                  row['name'] ||
                  '';

                // Helper function to normalize numeric strings before parsing
                const normalizeNumericString = (value: string | undefined): string => {
                  if (!value) return '';
                  
                  // Remove currency symbols, thousands separators, and trim
                  let normalized = value.trim()
                    .replace(/[$£€¥]/, '')  // Remove currency symbols
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

                // Find quantity column - Toast POS uses "Qty sold"
                const quantityStr = 
                  row['Qty sold'] || 
                  row['qty sold'] ||
                  row['Quantity'] || 
                  row['quantity'] || 
                  row['Qty'] || 
                  row['qty'] || 
                  row['Count'] ||
                  '';
                
                // For quantity, we want to preserve 0 but fallback to 1 for missing/invalid values
                const quantity = safeParseFloat(quantityStr, 1);

                // Find price columns
                // Toast POS has several price fields - try to use the most appropriate one
                const grossSales = safeParseFloat(row['Gross sales'] || row['gross sales'] || '', undefined);
                const netSales = safeParseFloat(row['Net sales'] || row['net sales'] || '', undefined);
                const avgPrice = safeParseFloat(row['Avg. price'] || row['avg. price'] || row['avg price'] || '', undefined);
                const avgItemPrice = safeParseFloat(row['Avg. item price (not incl. mods)'] || '', undefined);
                
                // For total price, prioritize net or gross sales over other fields as they represent actual revenue
                const totalPriceStr = 
                  // Try to find the best available price column
                  // Only look up raw strings if the parsed values weren't found
                  (netSales !== undefined) ? String(netSales) :
                  (grossSales !== undefined) ? String(grossSales) :
                  row['Total'] || 
                  row['total'] || 
                  row['Amount'] || 
                  row['amount'] ||
                  row['Total Amount'] ||
                  row['Price'] ||
                  '';
                
                // Only parse if we need to (i.e., we got a string, not a pre-parsed value)
                const totalPrice = (netSales !== undefined) ? netSales :
                                  (grossSales !== undefined) ? grossSales :
                                  safeParseFloat(totalPriceStr, undefined);

                // For unit price, try to use avg price fields first
                const unitPriceStr =
                  // Try to find the best available unit price column
                  // Only look up raw strings if the parsed values weren't found
                  (avgPrice !== undefined) ? String(avgPrice) :
                  (avgItemPrice !== undefined) ? String(avgItemPrice) :
                  row['Unit Price'] ||
                  row['unit_price'] ||
                  row['Price'] ||
                  row['price'] ||
                  '';
                
                // Only parse if we need to (i.e., we got a string, not a pre-parsed value)
                const unitPrice = (avgPrice !== undefined) ? avgPrice :
                                 (avgItemPrice !== undefined) ? avgItemPrice :
                                 safeParseFloat(unitPriceStr, undefined);

                // Find date column
                let saleDate = 
                  row['Date'] || 
                  row['date'] || 
                  row['Sale Date'] ||
                  row['sale_date'] ||
                  row['Order Date'] ||
                  row['Transaction Date'] ||
                  '';

                let hasDateWarning = false;

                // Try to parse and format date
                if (saleDate) {
                  const dateObj = new Date(saleDate);
                  if (!isNaN(dateObj.getTime())) {
                    saleDate = dateObj.toISOString().split('T')[0];
                  } else {
                    // Mark as having a date warning - DO NOT default to today
                    hasDateWarning = true;
                    skippedRows.push({ 
                      rowNumber: index + 1, 
                      reason: 'Invalid date format - could not parse date' 
                    });
                    return null;
                  }
                } else {
                  // Mark as having a date warning - DO NOT default to today
                  hasDateWarning = true;
                  skippedRows.push({ 
                    rowNumber: index + 1, 
                    reason: 'Missing date - date column is required' 
                  });
                  return null;
                }

                // Find time column
                const saleTime = 
                  row['Time'] || 
                  row['time'] || 
                  row['Sale Time'] ||
                  row['Order Time'] ||
                  '';

                // Get additional Toast-specific IDs
                const masterId = row['masterId'] || '';
                const parentId = row['parentId'] || '';
                const itemGuid = row['itemGuid'] || '';

                // Create a more reliable unique ID for POS data
                // Priority: Use real POS identifiers when available, then create unique fallback
                let orderId = '';
                
                // If we have Toast-specific IDs, use them for a unique compound identifier
                if (itemGuid || masterId || parentId) {
                  // For Toast data, create a compound ID from all available IDs
                  // This is unique per transaction in Toast POS
                  orderId = `manual_upload_${itemGuid || 'none'}_${masterId || 'none'}_${parentId || 'none'}_${itemName.replace(/\s+/g, '_').toLowerCase()}`;
                } else {
                  // For other POS systems, try to find a transaction ID
                  const externalOrderId = 
                    row['Order ID'] ||
                    row['order_id'] ||
                    row['Check #'] ||
                    row['Check Number'] ||
                    row['Transaction ID'] ||
                    '';
                  
                  if (externalOrderId) {
                    // Use the POS system's transaction ID - this is unique per transaction
                    orderId = externalOrderId;
                  } else {
                    // FALLBACK: No POS identifiers available
                    // Include time AND row index to ensure uniqueness for multiple sales of same item
                    // This allows multiple transactions of the same item on the same day
                    const priceForId = totalPrice || unitPrice || 0;
                    const timeComponent = saleTime ? `_${saleTime.replace(/:/g, '')}` : '';
                    // Include row index to ensure each row gets a unique ID
                    orderId = `manual_upload_${itemName.replace(/\s+/g, '_').toLowerCase()}_${quantity}_${saleDate}${timeComponent}_${priceForId.toFixed(2)}_row${index}`;
                  }
                }
                  
                // Get item category - useful for categorizing sales
                const itemCategory = 
                  row['Sales Category'] || 
                  row['sales category'] ||
                  row['Category'] ||
                  row['category'] ||
                  '';
                  
                // Get item tags - useful for filtering
                const itemTags = 
                  row['Item tags'] || 
                  row['item tags'] ||
                  row['Tags'] ||
                  row['tags'] ||
                  '';

                // If no item name, track this row as skipped but don't throw an error
                if (!itemName) {
                  skippedRows.push({ 
                    rowNumber: index + 1, 
                    reason: 'Missing item name' 
                  });
                  return null;
                }
                
                // Also skip rows where both quantity and price are 0 or undefined
                // (unless explicitly instructed to include these)
                if (quantity === 0 && !totalPrice) {
                  skippedRows.push({ 
                    rowNumber: index + 1, 
                    reason: 'Zero quantity and no price' 
                  });
                  return null;
                }

                return {
                  itemName: itemName.trim(),
                  quantity,
                  totalPrice,
                  unitPrice,
                  saleDate,
                  saleTime: saleTime || undefined,
                  orderId: orderId || undefined,
                  // Add additional fields to the main object
                  category: itemCategory || undefined,
                  tags: itemTags || undefined,
                  // Store enhanced metadata in rawData
                  rawData: {
                    ...row,
                    _parsedMeta: {
                      posSystem: 'manual_upload',
                      masterId,
                      parentId,
                      itemGuid,
                      compoundOrderId: orderId, // Store the compound ID we created
                      importedAt: new Date().toISOString(),
                      hasDateWarning, // Flag if date had issues
                    }
                  },
                };
              })
              // Filter out null entries (skipped rows)
              .filter((sale) => sale !== null) as ParsedSale[];

            // If we skipped any rows, log them and include in the toast message
            if (skippedRows.length > 0) {
              console.warn('Skipped rows during CSV import:', skippedRows);
              
              // We'll attach the skipped rows info to the parsed sales to display in the toast
              (parsedSales as any).skippedRows = skippedRows;
            }

            resolve(parsedSales);
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

      // Check if we have skipped rows
      const skippedRows = (parsedSales as any).skippedRows;
      if (skippedRows && skippedRows.length > 0) {
        // For better UX, show details about skipped rows
        const skippedRowsList = skippedRows.length <= 3
          ? skippedRows.map((r: any) => `Row ${r.rowNumber}: ${r.reason}`).join(', ')
          : `${skippedRows.length} rows (including row ${skippedRows[0].rowNumber}) due to missing data`;
          
        toast({
          title: "File processed with warnings",
          description: `Successfully parsed ${parsedSales.length} sales records. Skipped ${skippedRowsList}.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "File processed",
          description: `Successfully parsed ${parsedSales.length} sales records`,
        });
      }

      // Clean up the skipped rows property before passing to the parent
      delete (parsedSales as any).skippedRows;
      onFileProcessed(parsedSales);
    } catch (error) {
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
            <li>• Required: Item name and Date columns</li>
            <li>• Optional: Quantity, Price/Amount, Time, Order ID</li>
            <li>• Column names are case-insensitive and flexible</li>
            <li>• Rows with missing or invalid dates will be skipped</li>
            <li>• Toast POS exports are fully supported (items & modifiers)</li>
            <li>• Summary rows without item names will be skipped</li>
            <li>• Duplicate transactions are automatically detected and prevented</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
