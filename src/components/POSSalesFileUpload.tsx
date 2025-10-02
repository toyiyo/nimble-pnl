import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import Papa from 'papaparse';

interface POSSalesFileUploadProps {
  onFileProcessed: (data: any[]) => void;
}

interface ParsedSale {
  itemName: string;
  quantity: number;
  totalPrice?: number;
  unitPrice?: number;
  saleDate: string;
  saleTime?: string;
  orderId?: string;
  rawData: any;
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
            const parsedSales = results.data.map((row: any, index: number) => {
              // Flexible column mapping - try to detect common column names
              // TOAST POS typically uses: Item, Quantity, Amount, Date, Time
              
              // Find item name column (case insensitive)
              const itemName = 
                row['Item'] || 
                row['item'] || 
                row['Item Name'] || 
                row['item_name'] ||
                row['Product'] ||
                row['product'] ||
                row['Menu Item'] ||
                row['Name'] ||
                row['name'] ||
                '';

              // Find quantity column
              const quantity = parseFloat(
                row['Quantity'] || 
                row['quantity'] || 
                row['Qty'] || 
                row['qty'] || 
                row['Count'] ||
                '1'
              ) || 1;

              // Find price columns
              const totalPrice = parseFloat(
                row['Total'] || 
                row['total'] || 
                row['Amount'] || 
                row['amount'] ||
                row['Total Amount'] ||
                row['Net Sales'] ||
                row['net_sales'] ||
                row['Price'] ||
                ''
              ) || undefined;

              const unitPrice = parseFloat(
                row['Unit Price'] ||
                row['unit_price'] ||
                row['Price'] ||
                row['price'] ||
                ''
              ) || undefined;

              // Find date column
              let saleDate = 
                row['Date'] || 
                row['date'] || 
                row['Sale Date'] ||
                row['sale_date'] ||
                row['Order Date'] ||
                row['Transaction Date'] ||
                '';

              // Try to parse and format date
              if (saleDate) {
                const dateObj = new Date(saleDate);
                if (!isNaN(dateObj.getTime())) {
                  saleDate = dateObj.toISOString().split('T')[0];
                } else {
                  // Default to today if date parsing fails
                  saleDate = new Date().toISOString().split('T')[0];
                }
              } else {
                saleDate = new Date().toISOString().split('T')[0];
              }

              // Find time column
              const saleTime = 
                row['Time'] || 
                row['time'] || 
                row['Sale Time'] ||
                row['Order Time'] ||
                '';

              // Find order ID
              const orderId = 
                row['Order ID'] ||
                row['order_id'] ||
                row['Check #'] ||
                row['Check Number'] ||
                row['Transaction ID'] ||
                '';

              if (!itemName) {
                throw new Error(`Row ${index + 1}: Missing item name`);
              }

              return {
                itemName: itemName.trim(),
                quantity,
                totalPrice,
                unitPrice,
                saleDate,
                saleTime: saleTime || undefined,
                orderId: orderId || undefined,
                rawData: row,
              };
            });

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
    if (!file.name.endsWith('.csv')) {
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

      toast({
        title: "File processed",
        description: `Successfully parsed ${parsedSales.length} sales records`,
      });

      onFileProcessed(parsedSales);
    } catch (error: any) {
      console.error('Error processing file:', error);
      toast({
        title: "Error processing file",
        description: error.message || "Failed to parse CSV file",
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
            <li>• Required: Item name or product name column</li>
            <li>• Optional: Quantity, Price/Amount, Date, Time, Order ID</li>
            <li>• Column names are case-insensitive and flexible</li>
            <li>• Dates will be parsed automatically or default to today</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
