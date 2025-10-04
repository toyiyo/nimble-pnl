import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Save, CheckCircle } from 'lucide-react';
import { ReconciliationItemDetail } from './ReconciliationItemDetail';
import { useReconciliation } from '@/hooks/useReconciliation';

interface ReconciliationSessionProps {
  restaurantId: string;
  onComplete: () => void;
}

export function ReconciliationSession({ restaurantId, onComplete }: ReconciliationSessionProps) {
  const { items, loading, updateItemCount, saveProgress, calculateSummary } = useReconciliation(restaurantId);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filteredItems = items.filter(item =>
    item.product?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.product?.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const summary = calculateSummary();
  const progress = items.length > 0 ? (summary.total_items_counted / items.length) * 100 : 0;

  const getVarianceBadge = (varianceValue: number | null) => {
    if (varianceValue === null) return null;
    if (varianceValue === 0) return <Badge className="bg-green-500">🟢 OK</Badge>;
    const absValue = Math.abs(varianceValue);
    if (absValue < 50) return <Badge className="bg-yellow-500">🟡 -${absValue.toFixed(2)}</Badge>;
    return <Badge variant="destructive">🔴 -${absValue.toFixed(2)}</Badge>;
  };

  const handleQuickCount = async (itemId: string, value: string) => {
    const qty = value === '' ? null : parseFloat(value);
    await updateItemCount(itemId, qty);
  };

  const handleItemClick = (item: any) => {
    setSelectedItem(item);
    setDetailOpen(true);
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

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search products..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Items Table */}
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
            {filteredItems.map((item) => (
              <tr
                key={item.id}
                className="border-t hover:bg-muted/50 cursor-pointer"
                onClick={() => handleItemClick(item)}
              >
                <td className="p-3">
                  <div>
                    <div className="font-medium">{item.product?.name}</div>
                    <div className="text-sm text-muted-foreground">{item.product?.sku}</div>
                  </div>
                </td>
                <td className="p-3">{item.product?.uom_purchase}</td>
                <td className="text-right p-3">{item.expected_quantity}</td>
                <td className="p-3">
                  <Input
                    type="number"
                    step="0.01"
                    value={item.actual_quantity ?? ''}
                    onChange={(e) => handleQuickCount(item.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-24 text-center"
                    placeholder="Count"
                  />
                </td>
                <td className="text-right p-3">
                  {item.variance !== null ? item.variance.toFixed(2) : '-'}
                </td>
                <td className="text-center p-3">
                  {item.actual_quantity !== null ? (
                    getVarianceBadge(item.variance_value)
                  ) : (
                    <Badge variant="outline">Not Counted</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
