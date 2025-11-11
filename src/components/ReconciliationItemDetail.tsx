import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { 
  Package, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle,
  DollarSign,
  Calendar,
  Barcode,
  Tag,
  History,
  Plus
} from 'lucide-react';
import { ReconciliationItemFinds } from './ReconciliationItemFinds';
import { QuickInventoryDialog } from './QuickInventoryDialog';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Product } from '@/hooks/useProducts';

interface ReconciliationItemDetailProps {
  item: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (itemId: string, actualQty: number | null, notes?: string) => Promise<boolean>;
  onAddFind?: (itemId: string, quantity: number, location?: string) => Promise<void>;
  onDeleteFind?: (findId: string) => Promise<void>;
  restaurantId: string;
}

export function ReconciliationItemDetail({
  item,
  open,
  onOpenChange,
  onUpdate,
  onAddFind,
  onDeleteFind,
  restaurantId,
}: ReconciliationItemDetailProps) {
  const [notes, setNotes] = useState(item.notes || '');
  const [transactionHistory, setTransactionHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showAddFindDialog, setShowAddFindDialog] = useState(false);
  const [findsRefetchTrigger, setFindsRefetchTrigger] = useState(0);
  const [currentItem, setCurrentItem] = useState(item);
  const { toast } = useToast();

  useEffect(() => {
    setNotes(item.notes || '');
    setCurrentItem(item);
    if (open) {
      fetchTransactionHistory();
    }
  }, [item, open]);

  const refreshItemData = async () => {
    try {
      const { data, error } = await supabase
        .from('reconciliation_items')
        .select('*, product:products(*)')
        .eq('id', item.id)
        .single();

      if (error) throw error;
      if (data) {
        setCurrentItem(data);
      }
    } catch (error) {
      console.error('Error refreshing item data:', error);
    }
  };

  const fetchTransactionHistory = async () => {
    setLoadingHistory(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('product_id', item.product_id)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setTransactionHistory(data || []);
    } catch (error) {
      console.error('Error fetching transaction history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSaveNotes = async () => {
    await onUpdate(item.id, item.actual_quantity, notes);
    toast({
      title: 'Notes updated',
      description: 'Item notes have been saved'
    });
  };

  const handleAddFind = async (quantity: number, location?: string) => {
    if (onAddFind) {
      await onAddFind(item.id, quantity, location);
      toast({
        title: 'Find added',
        description: `Added ${quantity} ${item.product?.uom_purchase || 'units'} @ ${location || 'unspecified'}`
      });
      await Promise.all([
        fetchTransactionHistory(),
        refreshItemData()
      ]);
      setFindsRefetchTrigger(prev => prev + 1);
    }
  };

  const handleFindsChange = async () => {
    await Promise.all([
      fetchTransactionHistory(),
      refreshItemData()
    ]);
  };

  const productForDialog: Product = {
    id: currentItem.product_id,
    name: currentItem.product?.name || 'Unknown Product',
    uom_purchase: currentItem.product?.uom_purchase || 'units',
    current_stock: currentItem.actual_quantity,
    restaurant_id: restaurantId,
    sku: currentItem.product?.sku || '',
    brand: null,
    category: null,
    created_at: '',
    updated_at: '',
    cost_per_unit: currentItem.unit_cost,
    gtin: undefined,
    size_value: null,
    size_unit: null,
    uom_recipe: null,
    reorder_point: null,
    par_level_min: null,
    par_level_max: null,
    supplier_id: null,
    image_url: null
  };

  const variance = currentItem.actual_quantity !== null 
    ? currentItem.actual_quantity - currentItem.expected_quantity 
    : null;
  const varianceValue = variance !== null ? variance * (currentItem.unit_cost || 0) : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {currentItem.product?.name}
            </SheetTitle>
            <SheetDescription>
              {currentItem.product?.sku && (
                <div className="flex items-center gap-1 text-xs">
                  <Barcode className="h-3 w-3" />
                  SKU: {currentItem.product.sku}
                </div>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Quantities Display */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Expected</div>
                <div className="text-2xl font-bold">{currentItem.expected_quantity}</div>
                <div className="text-xs text-muted-foreground">{currentItem.product?.uom_purchase}</div>
              </div>
              <div className="p-4 bg-primary/5 border-2 border-primary/20 rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Actual</div>
                <div className="text-2xl font-bold text-primary">
                  {currentItem.actual_quantity || 0}
                </div>
                <div className="text-xs text-muted-foreground">{currentItem.product?.uom_purchase}</div>
              </div>
            </div>

            {/* Variance Display */}
            {variance !== null && variance !== 0 && (
              <div className={`p-4 rounded-lg border-2 ${
                variance < 0 
                  ? 'bg-destructive/5 border-destructive/20' 
                  : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800'
              }`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {variance < 0 ? (
                        <TrendingDown className="h-5 w-5 text-destructive" />
                      ) : (
                        <TrendingUp className="h-5 w-5 text-yellow-600" />
                      )}
                      <span className="font-semibold">
                        {variance < 0 ? 'Shrinkage' : 'Overage'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {variance > 0 ? '+' : ''}{variance.toFixed(2)} {currentItem.product?.uom_purchase}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 mb-1">
                      <DollarSign className="h-4 w-4" />
                      <span className="text-sm font-medium">Value Impact</span>
                    </div>
                    <div className="text-2xl font-bold">
                      ${Math.abs(varianceValue || 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* Finds Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Item Finds</h3>
                <Button
                  size="sm"
                  onClick={() => setShowAddFindDialog(true)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Find
                </Button>
              </div>
              
              <ReconciliationItemFinds
                itemId={currentItem.id}
                productName={currentItem.product?.name || 'Unknown'}
                uom={currentItem.product?.uom_purchase || 'units'}
                onFindsChange={handleFindsChange}
                onDeleteFind={onDeleteFind}
                refetchTrigger={findsRefetchTrigger}
              />

              <div className="text-sm text-muted-foreground">
                Expected: {currentItem.expected_quantity} {currentItem.product?.uom_purchase || 'units'}
              </div>
            </div>

            <Separator />

            {/* Recent Transaction History */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Recent Activity (Last 30 Days)</h3>
              </div>
              
              {loadingHistory ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : transactionHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg text-center">
                  No recent transactions
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {transactionHistory.map((tx) => (
                    <div key={tx.id} className="flex justify-between items-start p-3 bg-muted rounded-lg text-sm">
                      <div className="flex-1">
                        <div className="font-medium capitalize">{tx.transaction_type}</div>
                        {tx.reason && (
                          <div className="text-xs text-muted-foreground mt-1">{tx.reason}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold ${
                          tx.quantity > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(tx.created_at), 'MMM d')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Notes Section */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this item (e.g., broken bottle, found in storage)"
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={handleSaveNotes} className="flex-1">
                Save Notes
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickInventoryDialog
        open={showAddFindDialog}
        onOpenChange={setShowAddFindDialog}
        product={productForDialog}
        mode="add"
        onSave={handleAddFind}
        currentTotal={currentItem.actual_quantity || 0}
        restaurantId={restaurantId}
      />
    </>
  );
}
