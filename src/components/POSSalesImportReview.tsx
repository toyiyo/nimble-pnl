import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, AlertCircle, Edit2, Save, X, Upload, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';

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
  rawData: {
    _parsedMeta?: {
      compoundOrderId?: string;
      posSystem?: string;
      isVoidedOrZeroQuantity?: boolean;
      voidAmount?: number;
    };
    masterId?: string;
    parentId?: string;
    itemGuid?: string;
    [key: string]: unknown;
  };
}

interface EditableSale extends ParsedSale {
  id: string;
  isEditing: boolean;
  hasError: boolean;
  errorMessage?: string;
  isVoidedOrZeroQuantity?: boolean;
  shouldInclude?: boolean; // User's decision to include or exclude
}

interface POSSalesImportReviewProps {
  salesData: ParsedSale[];
  onImportComplete: () => void;
  onCancel: () => void;
}

export const POSSalesImportReview: React.FC<POSSalesImportReviewProps> = ({
  salesData,
  onImportComplete,
  onCancel,
}) => {
  const [editableSales, setEditableSales] = useState<EditableSale[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [needsDateInput, setNeedsDateInput] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();

  useEffect(() => {
    // Check if we need date input from the metadata
    const needsDate = (salesData as any).needsDateInput === true;
    setNeedsDateInput(needsDate);
    
    // Convert parsed sales to editable format
    const editable = salesData.map((sale, index) => {
      const isVoided = sale.rawData._parsedMeta?.isVoidedOrZeroQuantity === true;
      return {
        ...sale,
        id: `temp-${index}`,
        isEditing: false,
        hasError: !sale.itemName || (needsDate && !sale.saleDate),
        errorMessage: !sale.itemName ? 'Item name is required' : (needsDate && !sale.saleDate ? 'Date is required' : undefined),
        isVoidedOrZeroQuantity: isVoided,
        shouldInclude: !isVoided, // By default, exclude voided items
      };
    });
    setEditableSales(editable);
  }, [salesData]);

  const handleEdit = (id: string) => {
    setEditableSales(prev =>
      prev.map(sale =>
        sale.id === id ? { ...sale, isEditing: true } : sale
      )
    );
  };

  const handleSave = (id: string) => {
    setEditableSales(prev =>
      prev.map(sale => {
        if (sale.id === id) {
          const hasError = !sale.itemName;
          return {
            ...sale,
            isEditing: false,
            hasError,
            errorMessage: hasError ? 'Item name is required' : undefined,
          };
        }
        return sale;
      })
    );
  };

  const handleCancel = (id: string) => {
    setEditableSales(prev =>
      prev.map(sale =>
        sale.id === id ? { ...sale, isEditing: false } : sale
      )
    );
  };

  const handleFieldChange = (id: string, field: keyof ParsedSale, value: string | number | undefined) => {
    setEditableSales(prev =>
      prev.map(sale =>
        sale.id === id ? { ...sale, [field]: value } : sale
      )
    );
  };

  const handleRemove = (id: string) => {
    setEditableSales(prev => prev.filter(sale => sale.id !== id));
  };

  const handleApplyDate = (date: Date | undefined) => {
    if (!date) return;
    
    setSelectedDate(date);
    // Get restaurant timezone or fallback to browser timezone
    const timezone = selectedRestaurant?.restaurant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Format the date in the restaurant's timezone to ensure it stays as the selected date
    const dateString = formatInTimeZone(date, timezone, 'yyyy-MM-dd');
    
    // Apply the date to all sales
    setEditableSales(prev =>
      prev.map(sale => ({
        ...sale,
        saleDate: dateString,
        hasError: !sale.itemName, // Update error state
        errorMessage: !sale.itemName ? 'Item name is required' : undefined,
      }))
    );
    
    toast({
      title: "Date applied",
      description: `Applied ${format(date, 'MMM d, yyyy')} to all ${editableSales.length} sales records`,
    });
  };

  const handleImport = async () => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return;
    }

    // Check if we need a date but haven't selected one yet
    if (needsDateInput && !selectedDate) {
      toast({
        title: "Date required",
        description: "Please select a sale date before importing",
        variant: "destructive",
      });
      return;
    }

    const hasErrors = editableSales.some(sale => sale.hasError);
    if (hasErrors) {
      toast({
        title: "Validation errors",
        description: "Please fix all errors before importing",
        variant: "destructive",
      });
      return;
    }

    if (editableSales.length === 0) {
      toast({
        title: "No data to import",
        description: "Please add sales records before importing",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);

    try {
      // Prepare data for bulk insert (only include items user wants to import)
      const salesToInsert = editableSales
        .filter(sale => sale.shouldInclude !== false)
        .map(sale => {
        // Get the best possible unique ID
        const externalOrderId = 
          // Try to use the compound ID first (for Toast POS data)
          sale.rawData._parsedMeta?.compoundOrderId || 
          // Then try the original order ID
          sale.orderId || 
          // For masterId/itemGuid combination from Toast
          (sale.rawData.masterId && sale.rawData.itemGuid ? 
            `toast_${sale.rawData.itemGuid}_${sale.rawData.masterId}` : 
            // Finally, generate a fallback ID
            `file_import_${Date.now()}_${sale.id}`);
            
        return {
          restaurant_id: selectedRestaurant.restaurant_id,
          pos_system: 'manual_upload',
          external_order_id: externalOrderId,
          item_name: sale.itemName,
          quantity: sale.quantity,
          unit_price: sale.unitPrice,
          total_price: sale.totalPrice ?? (sale.unitPrice != null ? sale.unitPrice * sale.quantity : undefined),
          sale_date: sale.saleDate,
          sale_time: sale.saleTime,
          // Remove the category field from direct insert since it doesn't exist in the DB schema
          // Instead, store it only in the raw_data JSON field
          raw_data: {
            source: 'file_import',
            imported_at: new Date().toISOString(),
            // Only include essential fields from raw data
            item_data: {
              name: sale.itemName,
              category: sale.category || null,
              tags: sale.tags || null,
            },
            // Store identifiers
            identifiers: {
              order_id: sale.orderId || null,
              master_id: sale.rawData.masterId || null,
              parent_id: sale.rawData.parentId || null,
              item_guid: sale.rawData.itemGuid || null,
            }
          },
        };
      });

      // Check for potential duplicate external_order_ids first
      let recordsToInsert = [...salesToInsert]; // Create a mutable copy
      
      try {
        // Extract just the external_order_ids for checking
        const orderIds = recordsToInsert.map(sale => sale.external_order_id);
        
        // Check if any of these IDs already exist in the database
        const { data: existingRecords, error: checkError } = await supabase
          .from('unified_sales')
          .select('external_order_id')
          .in('external_order_id', orderIds)
          .eq('restaurant_id', selectedRestaurant.restaurant_id);
          
        if (checkError) {
          console.error('Error checking for duplicates:', checkError);
        } else if (existingRecords && existingRecords.length > 0) {
          // We found potential duplicates
          const existingIds = existingRecords.map(record => record.external_order_id);
          console.warn('Found potential duplicate records:', existingIds);
          
          // Filter out sales that would be duplicates
          const filteredSales = recordsToInsert.filter(sale => 
            !existingIds.includes(sale.external_order_id)
          );
          
          // If all are duplicates, throw an error
          if (filteredSales.length === 0) {
            throw new Error(`All ${recordsToInsert.length} records appear to be duplicates of existing sales data.`);
          }
          
          // Otherwise warn and continue with non-duplicates
          toast({
            title: "Duplicate records detected",
            description: `Found ${existingIds.length} duplicate records that will be skipped.`,
            variant: "destructive",
          });
          
          // Update our array with the filtered one
          recordsToInsert = filteredSales;
        }
      } catch (dupCheckError) {
        if (dupCheckError instanceof Error) {
          throw dupCheckError; // Re-throw if it's our specific error
        }
        console.error('Error in duplicate checking process:', dupCheckError);
      }

      // Now proceed with bulk insert for non-duplicate records
      const { error, data } = await supabase
        .from('unified_sales')
        .insert(recordsToInsert as any)
        .select();

      if (error) {
        console.error('Database error during import:', error);
        
        // Format a user-friendly error message
        let errorMessage = "Failed to import sales data";
        
        if (error.code === 'PGRST204') {
          // Schema-related errors
          errorMessage = `Database schema error: ${error.message}`;
        } else if (error.code === '23505') {
          // Unique constraint violation - this should be caught by our pre-check,
          // but handle it gracefully just in case
          errorMessage = "Duplicate entries detected. These sales might already exist in the system.";
        } else if (error.code) {
          // Any other specific error with a code
          errorMessage = `Database error (${error.code}): ${error.message}`;
        }
        
        throw new Error(errorMessage);
      }

      toast({
        title: "Import successful",
        description: `Successfully imported ${editableSales.length} sales records`,
      });

      onImportComplete();
    } catch (error) {
      console.error('Error importing sales:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to import sales data";
      toast({
        title: "Import failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const validCount = editableSales.filter(s => !s.hasError && s.shouldInclude !== false).length;
  const errorCount = editableSales.filter(s => s.hasError).length;
  const voidedCount = editableSales.filter(s => s.isVoidedOrZeroQuantity).length;
  const excludedCount = editableSales.filter(s => s.shouldInclude === false).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Review Imported Sales</CardTitle>
              <CardDescription>
                Review and edit the imported sales data before saving
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-success">
                <CheckCircle className="w-3 h-3 mr-1" />
                {validCount} Valid
              </Badge>
              {errorCount > 0 && (
                <Badge variant="destructive">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {errorCount} Errors
                </Badge>
              )}
              {voidedCount > 0 && (
                <Badge variant="outline" className="text-warning">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {voidedCount} Voided/Zero
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {needsDateInput && (
            <Alert className="mb-4">
              <Calendar className="h-4 w-4" />
              <AlertDescription>
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-sm font-medium">This file doesn't contain date information. Please select the sale date:</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[240px] justify-start text-left font-normal",
                          !selectedDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleApplyDate}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {voidedCount > 0 && (
            <Alert className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Found {voidedCount} voided or zero-quantity items (e.g., refunds, voids, or items with $0 sales).
                  </p>
                  <p className="text-sm text-muted-foreground">
                    These items are excluded by default. Click "Include" on any item to add it to the import.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editableSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No sales to review
                    </TableCell>
                  </TableRow>
                ) : (
                  editableSales.map((sale) => (
                    <TableRow 
                      key={sale.id} 
                      className={cn(
                        sale.hasError ? 'bg-destructive/10' : '',
                        sale.isVoidedOrZeroQuantity && 'bg-warning/10',
                        sale.shouldInclude === false && 'opacity-50'
                      )}
                    >
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            value={sale.itemName}
                            onChange={(e) => handleFieldChange(sale.id, 'itemName', e.target.value)}
                            className={sale.hasError ? 'border-destructive' : ''}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            {sale.hasError && <AlertCircle className="w-4 h-4 text-destructive" />}
                            {sale.isVoidedOrZeroQuantity && (
                              <Badge variant="outline" className="text-xs">
                                Voided/Zero
                              </Badge>
                            )}
                            <span className={sale.hasError ? 'text-destructive' : ''}>{sale.itemName || '(empty)'}</span>
                            {sale.tags && <span className="text-xs px-1 bg-muted rounded">{sale.tags}</span>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            value={sale.category || ''}
                            onChange={(e) => handleFieldChange(sale.id, 'category', e.target.value || undefined)}
                            placeholder="Category"
                            className="w-full"
                          />
                        ) : (
                          <span className="text-sm">{sale.category || '-'}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            type="number"
                            value={sale.quantity}
                            onChange={(e) => handleFieldChange(sale.id, 'quantity', parseFloat(e.target.value) || 1)}
                            className="w-20"
                          />
                        ) : (
                          sale.quantity
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={sale.unitPrice || ''}
                            onChange={(e) => handleFieldChange(sale.id, 'unitPrice', parseFloat(e.target.value) || undefined)}
                            className="w-24"
                            placeholder="0.00"
                          />
                        ) : (
                          sale.unitPrice ? `$${sale.unitPrice.toFixed(2)}` : '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={sale.totalPrice || ''}
                            onChange={(e) => handleFieldChange(sale.id, 'totalPrice', parseFloat(e.target.value) || undefined)}
                            className="w-24"
                            placeholder="0.00"
                          />
                        ) : (
                          sale.totalPrice ? `$${sale.totalPrice.toFixed(2)}` : '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            type="date"
                            value={sale.saleDate}
                            onChange={(e) => handleFieldChange(sale.id, 'saleDate', e.target.value)}
                            className="w-36"
                          />
                        ) : sale.saleDate ? (() => {
                          // Parse date string as local date, not UTC
                          const [year, month, day] = sale.saleDate.split('-').map(Number);
                          const localDate = new Date(year, month - 1, day);
                          return format(localDate, 'MMM d, yyyy');
                        })() : (
                          <span className="text-muted-foreground italic">No date</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.isEditing ? (
                          <Input
                            type="time"
                            value={sale.saleTime || ''}
                            onChange={(e) => handleFieldChange(sale.id, 'saleTime', e.target.value || undefined)}
                            className="w-28"
                          />
                        ) : (
                          sale.saleTime || '-'
                        )}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {sale.isEditing ? (
                          <Input
                            value={sale.orderId || ''}
                            onChange={(e) => handleFieldChange(sale.id, 'orderId', e.target.value || undefined)}
                            placeholder="Optional"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">{sale.orderId || '-'}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {sale.isVoidedOrZeroQuantity && !sale.isEditing && (
                            <Button
                              variant={sale.shouldInclude ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                setEditableSales(prev =>
                                  prev.map(s =>
                                    s.id === sale.id ? { ...s, shouldInclude: !s.shouldInclude } : s
                                  )
                                );
                              }}
                            >
                              {sale.shouldInclude ? "Exclude" : "Include"}
                            </Button>
                          )}
                          {sale.isEditing ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleSave(sale.id)}
                              >
                                <Save className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCancel(sale.id)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEdit(sale.id)}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemove(sale.id)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {errorCount > 0 && (
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive rounded-lg">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-4 h-4" />
                <span className="font-medium">
                  {errorCount} {errorCount === 1 ? 'record has' : 'records have'} errors that must be fixed before importing
                </span>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="outline" onClick={onCancel} disabled={isImporting}>
              Cancel
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={isImporting || errorCount > 0 || editableSales.length === 0}
              className="flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {isImporting ? 'Importing...' : `Import ${validCount} ${validCount === 1 ? 'Sale' : 'Sales'}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
