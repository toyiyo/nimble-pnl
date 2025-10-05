import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Save, CheckCircle, ScanBarcode, X, Eye } from 'lucide-react';
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
}

export function ReconciliationSession({ restaurantId, onComplete }: ReconciliationSessionProps) {
  const { items, loading, updateItemCount, saveProgress, calculateSummary } = useReconciliation(restaurantId);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [quickDialogOpen, setQuickDialogOpen] = useState(false);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const { toast } = useToast();

  // Sync input values with items from database whenever items change
  useEffect(() => {
    const newValues: Record<string, string> = {};
    items.forEach(item => {
      // Only update if we don't have a local value or the item has been updated from database
      if (item.actual_quantity !== null && item.actual_quantity !== undefined) {
        newValues[item.id] = item.actual_quantity.toString();
      }
    });
    setInputValues(newValues);
  }, [items]);

  const filteredItems = items.filter(item =>
    item.product?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.product?.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      if (absValue < 50) return <Badge className="bg-yellow-500">🟡 -${absValue.toFixed(2)}</Badge>;
      return <Badge variant="destructive">🔴 -${absValue.toFixed(2)}</Badge>;
    }
    
    // No price but we have quantity variance - use quantity
    const absQty = Math.abs(varianceQty);
    if (absQty < 10) return <Badge className="bg-yellow-500">🟡 -{absQty.toFixed(2)} units</Badge>;
    return <Badge variant="destructive">🔴 -{absQty.toFixed(2)} units</Badge>;
  };

  const handleInputChange = (itemId: string, value: string) => {
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

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <div className="bg-card p-4 rounded-lg border">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-lg font-semibold">Counting in Progress</h3>
            <p className="text-sm text-muted-foreground">
              {summary.total_items_counted} of {items.length} items counted ({progress.toFixed(0)}%)
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setScannerMode(!scannerMode)} 
              variant={scannerMode ? "default" : "outline"}
            >
              {scannerMode ? <X className="mr-2 h-4 w-4" /> : <ScanBarcode className="mr-2 h-4 w-4" />}
              {scannerMode ? 'Close Scanner' : 'Scan Items'}
            </Button>
            <Button onClick={saveProgress} variant="outline" disabled={loading}>
              <Save className="mr-2 h-4 w-4" />
              Save Progress
            </Button>
            <Button onClick={onComplete} disabled={summary.total_items_counted === 0}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Review & Submit
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

      {/* Search Bar */}
      {!scannerMode && (
        <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search products..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
        </div>
      )}

      {/* Items Table */}
      {!scannerMode && (
        <div className="border rounded-lg overflow-hidden">
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
            {filteredItems.map((item) => {
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
    </div>
  );
}
