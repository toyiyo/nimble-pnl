import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { CheckCircle, AlertCircle, Edit2, Save, X, Upload } from 'lucide-react';
import { format } from 'date-fns';

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

interface EditableSale extends ParsedSale {
  id: string;
  isEditing: boolean;
  hasError: boolean;
  errorMessage?: string;
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
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();

  useEffect(() => {
    // Convert parsed sales to editable format
    const editable = salesData.map((sale, index) => ({
      ...sale,
      id: `temp-${index}`,
      isEditing: false,
      hasError: !sale.itemName,
      errorMessage: !sale.itemName ? 'Item name is required' : undefined,
    }));
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

  const handleImport = async () => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
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
      // Prepare data for bulk insert
      const salesToInsert = editableSales.map(sale => ({
        restaurant_id: selectedRestaurant.restaurant_id,
        pos_system: sale.rawData._parsedMeta?.posSystem?.toLowerCase() || 'manual', // Use detected POS system or fallback to manual
        external_order_id: sale.orderId || `file_import_${Date.now()}_${sale.id}`,
        item_name: sale.itemName,
        quantity: sale.quantity,
        unit_price: sale.unitPrice,
        total_price: sale.totalPrice || (sale.unitPrice ? sale.unitPrice * sale.quantity : undefined),
        sale_date: sale.saleDate,
        sale_time: sale.saleTime,
        // Remove the category field from direct insert since it doesn't exist in the DB schema
        // Instead, store it only in the raw_data JSON field
        raw_data: {
          source: 'file_import',
          imported_at: new Date().toISOString(),
          original_data: sale.rawData,
          category: sale.category,
          tags: sale.tags,
        },
      }));

      // Bulk insert into unified_sales
      const { error, data } = await supabase
        .from('unified_sales')
        .insert(salesToInsert)
        .select();

      if (error) {
        console.error('Database error during import:', error);
        
        // Format a user-friendly error message
        let errorMessage = "Failed to import sales data";
        
        if (error.code === 'PGRST204') {
          // Schema-related errors
          errorMessage = `Database schema error: ${error.message}`;
        } else if (error.code === '23505') {
          // Unique constraint violation
          errorMessage = "Duplicate entries detected. Some of these sales might already exist in the system.";
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

  const validCount = editableSales.filter(s => !s.hasError).length;
  const errorCount = editableSales.filter(s => s.hasError).length;

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
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
                    <TableRow key={sale.id} className={sale.hasError ? 'bg-destructive/10' : ''}>
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
                        ) : (
                          format(new Date(sale.saleDate), 'MMM d, yyyy')
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
