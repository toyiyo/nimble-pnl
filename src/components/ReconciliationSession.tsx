import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Save, CheckCircle, ScanBarcode, X, Eye, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ReconciliationItemDetail } from './ReconciliationItemDetail';
import { useReconciliation } from '@/hooks/useReconciliation';
import { EnhancedBarcodeScanner } from './EnhancedBarcodeScanner';
import { QuickInventoryDialog } from './QuickInventoryDialog';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';

interface ReconciliationSessionProps {
  restaurantId: string;
  onComplete: () => void;
  onCancel?: () => void;
}

type SortField = 'name' | 'unit' | 'expected' | 'actual' | 'variance' | 'status';
type SortDirection = 'asc' | 'desc';

export function ReconciliationSession({ restaurantId, onComplete, onCancel }: ReconciliationSessionProps) {
  const { items, loading, updateItemCount, saveProgress, calculateSummary, cancelReconciliation } = useReconciliation(restaurantId);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [quickDialogOpen, setQuickDialogOpen] = useState(false);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [dirtyInputs, setDirtyInputs] = useState<Set<string>>(new Set());
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { toast } = useToast();

  // Sync input values with items from database, but respect user's active edits
  useEffect(() => {
    const newValues: Record<string, string> = {};
    items.forEach(item => {
      // Only update if this input is not currently being edited
      if (!dirtyInputs.has(item.id)) {
        if (item.actual_quantity !== null && item.actual_quantity !== undefined) {
          newValues[item.id] = item.actual_quantity.toString();
        }
      } else {
        // Keep the current value if it's dirty
        newValues[item.id] = inputValues[item.id] || '';
      }
    });
    setInputValues(newValues);
  }, [items, dirtyInputs]);

  const normalizedSearchTerm = (searchTerm || '').toLowerCase();
  
  const filteredAndSortedItems = items
    .filter(item =>
      (item.product?.name || '').toLowerCase().includes(normalizedSearchTerm) ||
      (item.product?.sku || '').toLowerCase().includes(normalizedSearchTerm)
    )
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'name':
          comparison = (a.product?.name || '').localeCompare(b.product?.name || '');
          break;
        case 'unit':
          comparison = (a.product?.uom_purchase || '').localeCompare(b.product?.uom_purchase || '');
          break;
        case 'expected':
          comparison = (a.expected_quantity || 0) - (b.expected_quantity || 0);
          break;
        case 'actual':
          const aActual = a.actual_quantity ?? -Infinity;
          const bActual = b.actual_quantity ?? -Infinity;
          comparison = aActual - bActual;
          break;
        case 'variance':
          const aVariance = a.variance ?? -Infinity;
          const bVariance = b.variance ?? -Infinity;
          comparison = aVariance - bVariance;
          break;
        case 'status':
          const aStatus = a.actual_quantity === null ? 0 : 1;
          const bStatus = b.actual_quantity === null ? 0 : 1;
          comparison = aStatus - bStatus;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  const summary = calculateSummary();
  const progress = items.length > 0 ? (summary.total_items_counted / items.length) * 100 : 0;

  const getVarianceBadge = (varianceQty: number | null, varianceValue: number | null, unitCost: number | null) => {
    // If no count entered yet
    if (varianceQty === null) return <Badge variant="outline">Not Counted</Badge>;
    
    // If quantity variance is zero, it's OK regardless of price
    if (varianceQty === 0) return <Badge className="bg-green-500">🟢 OK</Badge>;
    
    // If we have a price, use monetary variance
    if (varianceValue !== null && unitCost !== null && unitCost > 0) {
      const absValue = Math.abs(varianceValue);
      const sign = varianceValue >= 0 ? '+' : '';
      if (absValue < 50) return <Badge className="bg-yellow-500">🟡 {sign}${varianceValue.toFixed(2)}</Badge>;
      return <Badge variant="destructive">🔴 {sign}${varianceValue.toFixed(2)}</Badge>;
    }
    
    // No price but we have quantity variance - use quantity
    const absQty = Math.abs(varianceQty);
    const sign = varianceQty >= 0 ? '+' : '';
    if (absQty < 10) return <Badge className="bg-yellow-500">🟡 {sign}{varianceQty.toFixed(2)} units</Badge>;
    return <Badge variant="destructive">🔴 {sign}{varianceQty.toFixed(2)} units</Badge>;
  };

  const handleInputChange = (itemId: string, value: string) => {
    // Mark as dirty when user types
    setDirtyInputs(prev => new Set(prev).add(itemId));
    // Update local state immediately for responsive UI
    setInputValues(prev => ({ ...prev, [itemId]: value }));
  };
  
  // Calculate live variance for an item based on current input
  const calculateLiveVariance = (item: any) => {
    const inputValue = inputValues[item.id];
    if (!inputValue || inputValue === '') {
      return { variance: null, varianceValue: null };
    }
    
    const actualQty = parseFloat(inputValue);
    if (isNaN(actualQty)) {
      return { variance: null, varianceValue: null };
    }
    
    const variance = actualQty - item.expected_quantity;
    const varianceValue = item.unit_cost ? variance * item.unit_cost : null;
    
    return { variance, varianceValue };
  };

  const handleInputBlur = async (itemId: string, value: string) => {
    // Save to database when user finishes typing
    const qty = value === '' ? null : parseFloat(value);
    if (!isNaN(qty as number) || qty === null) {
      await updateItemCount(itemId, qty);
      // Clear dirty flag after successful save
      setDirtyInputs(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  };

  const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>, itemId: string, value: string) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur(); // Trigger blur to save
    }
  };

  const handleItemClick = (item: any) => {
    setSelectedItem(item);
    setDetailOpen(true);
  };

  const handleBarcodeScan = async (barcode: string) => {
    try {
      // Look up product by GTIN, SKU, or barcode_data
      const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .or(`gtin.eq.${barcode},sku.eq.${barcode}`)
        .limit(1);

      if (error) throw error;

      if (!products || products.length === 0) {
        toast({
          title: 'Product not found',
          description: `No product found with barcode: ${barcode}`,
          variant: 'destructive'
        });
        return;
      }

      const product = products[0] as Product;
      setScannedProduct(product);
      setQuickDialogOpen(true);
    } catch (error: any) {
      console.error('Error looking up product:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleQuickInventorySave = async (quantity: number) => {
    if (!scannedProduct) return;

    // Find the reconciliation item for this product
    const item = items.find(i => i.product_id === scannedProduct.id);
    
    if (!item) {
      toast({
        title: 'Error',
        description: 'This product is not in the current reconciliation session',
        variant: 'destructive'
      });
      return;
    }

    // Update the item count
    await updateItemCount(item.id, quantity);
    
    toast({
      title: 'Count updated',
      description: `${scannedProduct.name}: ${quantity} ${scannedProduct.uom_purchase || 'units'}`
    });
  };

  const handleCancel = () => {
    const currentSummary = calculateSummary();
    if (currentSummary.total_items_counted > 0) {
      setShowCancelDialog(true);
    } else {
      handleConfirmCancel();
    }
  };

  const handleConfirmCancel = async () => {
    const success = await cancelReconciliation();
    setShowCancelDialog(false);
    if (success && onCancel) {
      onCancel();
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <div className="bg-card p-4 rounded-lg border">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-2">
          <div>
            <h3 className="text-lg font-semibold">Counting in Progress</h3>
            <p className="text-sm text-muted-foreground">
              {summary.total_items_counted} of {items.length} items counted ({progress.toFixed(0)}%)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleCancel}
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive flex-1 md:flex-none"
            >
              <X className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
            <Button 
              onClick={() => setScannerMode(!scannerMode)} 
              variant={scannerMode ? "default" : "outline"}
              size="sm"
              className="flex-1 md:flex-none"
            >
              {scannerMode ? <X className="mr-2 h-4 w-4" /> : <ScanBarcode className="mr-2 h-4 w-4" />}
              <span className="hidden sm:inline">{scannerMode ? 'Close' : 'Scan'}</span>
            </Button>
            <Button onClick={saveProgress} variant="outline" size="sm" disabled={loading} className="flex-1 md:flex-none">
              <Save className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Save</span>
            </Button>
            <Button onClick={onComplete} size="sm" disabled={summary.total_items_counted === 0} className="flex-1 md:flex-none">
              <CheckCircle className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Review</span>
            </Button>
          </div>
        </div>
        <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Scanner Mode */}
      {scannerMode && (
        <div className="bg-card p-4 rounded-lg border">
          <EnhancedBarcodeScanner
            onScan={(barcode) => handleBarcodeScan(barcode)}
            onError={(error) => toast({ 
              title: 'Scanner error', 
              description: error, 
              variant: 'destructive' 
            })}
            autoStart={true}
          />
        </div>
      )}

      {/* Search and Sort Controls */}
      {!scannerMode && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Select value={sortField} onValueChange={(value) => setSortField(value as SortField)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="unit">Unit</SelectItem>
                <SelectItem value="expected">Expected</SelectItem>
                <SelectItem value="actual">Actual</SelectItem>
                <SelectItem value="variance">Variance</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
              aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDirection === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Items Table - Desktop */}
      {!scannerMode && (
        <>
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Product</th>
                  <th className="text-left p-3 font-medium">Unit</th>
                  <th className="text-right p-3 font-medium">Expected</th>
                  <th className="text-center p-3 font-medium">Actual Count</th>
                  <th className="text-right p-3 font-medium">Variance</th>
                  <th className="text-center p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedItems.map((item) => {
                  const liveVariance = calculateLiveVariance(item);
                  const displayVariance = liveVariance.variance !== null ? liveVariance.variance : item.variance;
                  const displayVarianceValue = liveVariance.varianceValue !== null ? liveVariance.varianceValue : item.variance_value;
                  
                  return (
                    <tr
                      key={item.id}
                      className="border-t hover:bg-accent/50 cursor-pointer transition-colors group"
                      onClick={() => handleItemClick(item)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium">{item.product?.name}</div>
                            <div className="text-sm text-muted-foreground">{item.product?.sku}</div>
                          </div>
                          <Eye className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </td>
                      <td className="p-3">{item.product?.uom_purchase}</td>
                      <td className="text-right p-3">{item.expected_quantity}</td>
                      <td className="p-3">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={inputValues[item.id] ?? ''}
                          onChange={(e) => handleInputChange(item.id, e.target.value)}
                          onBlur={(e) => handleInputBlur(item.id, e.target.value)}
                          onKeyDown={(e) => handleInputKeyDown(e, item.id, inputValues[item.id] ?? '')}
                          onClick={(e) => e.stopPropagation()}
                          className="w-24 text-center"
                          placeholder="Count"
                        />
                      </td>
                      <td className="text-right p-3">
                        {displayVariance !== null ? displayVariance.toFixed(2) : '-'}
                      </td>
                      <td className="text-center p-3">
                        {getVarianceBadge(displayVariance, displayVarianceValue, item.unit_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Items List - Mobile */}
          <div className="md:hidden space-y-3">
            {filteredAndSortedItems.map((item) => {
              const liveVariance = calculateLiveVariance(item);
              const displayVariance = liveVariance.variance !== null ? liveVariance.variance : item.variance;
              const displayVarianceValue = liveVariance.varianceValue !== null ? liveVariance.varianceValue : item.variance_value;
              
              return (
                <div
                  key={item.id}
                  className="border rounded-lg p-4 space-y-3 bg-card"
                  onClick={() => handleItemClick(item)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{item.product?.name}</div>
                      <div className="text-sm text-muted-foreground">{item.product?.sku}</div>
                    </div>
                    {getVarianceBadge(displayVariance, displayVarianceValue, item.unit_cost)}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground">Expected</div>
                      <div className="font-medium">{item.expected_quantity} {item.product?.uom_purchase}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Variance</div>
                      <div className="font-medium">{displayVariance !== null ? displayVariance.toFixed(2) : '-'}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-muted-foreground text-sm mb-1">Actual Count</div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={inputValues[item.id] ?? ''}
                      onChange={(e) => handleInputChange(item.id, e.target.value)}
                      onBlur={(e) => handleInputBlur(item.id, e.target.value)}
                      onKeyDown={(e) => handleInputKeyDown(e, item.id, inputValues[item.id] ?? '')}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-center text-lg"
                      placeholder="Enter count"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Quick Inventory Dialog for Scanned Items */}
      {scannedProduct && (
        <QuickInventoryDialog
          open={quickDialogOpen}
          onOpenChange={setQuickDialogOpen}
          product={scannedProduct}
          mode="reconcile"
          onSave={handleQuickInventorySave}
        />
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <ReconciliationItemDetail
          item={selectedItem}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onUpdate={updateItemCount}
          restaurantId={restaurantId}
        />
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancel Inventory Count?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <div>
                <strong>You are about to cancel this inventory count.</strong>
              </div>
              <div className="bg-muted p-3 rounded-md space-y-2">
                <p className="font-medium">Impact of canceling:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>{calculateSummary().total_items_counted} items have been counted</li>
                  <li>All progress will be permanently deleted</li>
                  <li>No inventory adjustments will be made</li>
                  <li>Product stock levels will remain unchanged</li>
                </ul>
              </div>
              <p className="text-destructive font-medium">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Counting</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, Cancel Count
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
