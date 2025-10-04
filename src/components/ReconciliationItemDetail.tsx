import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface ReconciliationItemDetailProps {
  item: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (itemId: string, actualQty: number | null, notes?: string) => Promise<boolean>;
  restaurantId: string;
}

export function ReconciliationItemDetail({
  item,
  open,
  onOpenChange,
  onUpdate,
  restaurantId,
}: ReconciliationItemDetailProps) {
  const [actualQty, setActualQty] = useState<string>(item.actual_quantity?.toString() || '');
  const [notes, setNotes] = useState(item.notes || '');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && item.product_id) {
      fetchTransactionHistory();
    }
  }, [open, item.product_id]);

  useEffect(() => {
    setActualQty(item.actual_quantity?.toString() || '');
    setNotes(item.notes || '');
  }, [item]);

  const fetchTransactionHistory = async () => {
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
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transaction history:', error);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    const qty = actualQty === '' ? null : parseFloat(actualQty);
    const success = await onUpdate(item.id, qty, notes);
    setLoading(false);
    if (success) {
      onOpenChange(false);
    }
  };

  const variance = actualQty !== '' ? parseFloat(actualQty) - item.expected_quantity : null;
  const varianceValue = variance !== null ? variance * item.unit_cost : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.product?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Count Section */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Expected Quantity</Label>
              <div className="text-2xl font-bold">{item.expected_quantity}</div>
              <div className="text-sm text-muted-foreground">{item.product?.uom_purchase}</div>
            </div>
            <div>
              <Label htmlFor="actual">Actual Count</Label>
              <Input
                id="actual"
                type="number"
                step="0.01"
                value={actualQty}
                onChange={(e) => setActualQty(e.target.value)}
                placeholder="Enter count"
                className="text-2xl font-bold"
              />
            </div>
          </div>

          {/* Variance Display */}
          {variance !== null && (
            <div className={`p-4 rounded-lg ${variance === 0 ? 'bg-green-50' : variance < 0 ? 'bg-red-50' : 'bg-yellow-50'}`}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-medium">Variance</div>
                  <div className="text-2xl font-bold">
                    {variance > 0 ? '+' : ''}{variance.toFixed(2)} {item.product?.uom_purchase}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">Value Impact</div>
                  <div className="text-2xl font-bold">
                    {varianceValue && varianceValue > 0 ? '+' : ''}${varianceValue?.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Transaction History */}
          <div>
            <Label>Recent Activity (Last 30 Days)</Label>
            <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent transactions</p>
              ) : (
                transactions.map((tx) => (
                  <div key={tx.id} className="flex justify-between text-sm border-b pb-2">
                    <div>
                      <span className="font-medium capitalize">{tx.transaction_type}</span>
                      {tx.reason && <span className="text-muted-foreground ml-2">• {tx.reason}</span>}
                    </div>
                    <div className="text-right">
                      <div className={tx.quantity > 0 ? 'text-green-600' : 'text-red-600'}>
                        {tx.quantity > 0 ? '+' : ''}{tx.quantity} {item.product?.uom_purchase}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(tx.created_at), 'MMM d, yyyy')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this variance (e.g., broken bottle, found in storage)"
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              Save Count
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
