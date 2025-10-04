import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Download, CheckCircle } from 'lucide-react';
import { useReconciliation } from '@/hooks/useReconciliation';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ReconciliationSummaryProps {
  restaurantId: string;
  onBack: () => void;
  onComplete: () => void;
}

export function ReconciliationSummary({ restaurantId, onBack, onComplete }: ReconciliationSummaryProps) {
  const { items, submitReconciliation, calculateSummary, loading } = useReconciliation(restaurantId);
  const [submitting, setSubmitting] = useState(false);
  const summary = calculateSummary();

  const topVariances = items
    .filter(item => item.variance_value !== null && item.variance_value !== 0)
    .sort((a, b) => Math.abs(b.variance_value!) - Math.abs(a.variance_value!))
    .slice(0, 10);

  const handleSubmit = async () => {
    setSubmitting(true);
    const success = await submitReconciliation();
    setSubmitting(false);
    if (success) {
      onComplete();
    }
  };

  const handleExportCSV = () => {
    const headers = ['Product', 'SKU', 'Expected', 'Actual', 'Variance', 'Variance Value', 'Notes'];
    const rows = items.map(item => [
      item.product?.name || '',
      item.product?.sku || '',
      item.expected_quantity,
      item.actual_quantity ?? '',
      item.variance ?? '',
      item.variance_value ?? '',
      item.notes ?? '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-summary-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const uncountedItems = items.filter(item => item.actual_quantity === null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Reconciliation Summary</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Back to Counting
          </Button>
          <Button variant="outline" onClick={handleExportCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {uncountedItems.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {uncountedItems.length} items have not been counted yet. You can still submit, but uncounted items will remain unchanged.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items Counted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total_items_counted}</div>
            <p className="text-xs text-muted-foreground">of {items.length} total items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items with Variance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.items_with_variance}</div>
            <p className="text-xs text-muted-foreground">
              {((summary.items_with_variance / summary.total_items_counted) * 100).toFixed(1)}% of counted items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Impact</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.total_shrinkage_value < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {summary.total_shrinkage_value < 0 ? '-' : '+'}${Math.abs(summary.total_shrinkage_value).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.total_shrinkage_value < 0 ? 'Shrinkage' : 'Overage'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Variances */}
      <Card>
        <CardHeader>
          <CardTitle>Top Variances</CardTitle>
        </CardHeader>
        <CardContent>
          {topVariances.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No variances detected</p>
          ) : (
            <div className="space-y-2">
              {topVariances.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{item.product?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Expected: {item.expected_quantity} • Actual: {item.actual_quantity} • Variance: {item.variance}
                    </div>
                    {item.notes && (
                      <div className="text-sm text-muted-foreground mt-1">Note: {item.notes}</div>
                    )}
                  </div>
                  <Badge variant={item.variance_value! < 0 ? 'destructive' : 'default'}>
                    {item.variance_value! < 0 ? '-' : '+'}${Math.abs(item.variance_value!).toFixed(2)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={submitting || loading || summary.total_items_counted === 0}
          className="w-full md:w-auto"
        >
          <CheckCircle className="mr-2 h-5 w-5" />
          Confirm & Submit Reconciliation
        </Button>
      </div>
    </div>
  );
}
