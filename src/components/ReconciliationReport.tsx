import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Download } from 'lucide-react';
import { useReconciliationHistory } from '@/hooks/useReconciliationHistory';
import { format } from 'date-fns';

interface ReconciliationReportProps {
  reconciliationId: string;
  onBack: () => void;
}

export function ReconciliationReport({ reconciliationId, onBack }: ReconciliationReportProps) {
  const { getReconciliationDetail, exportReconciliationCSV } = useReconciliationHistory(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDetail();
  }, [reconciliationId]);

  const loadDetail = async () => {
    setLoading(true);
    const data = await getReconciliationDetail(reconciliationId);
    setDetail(data);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">Loading reconciliation details...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <p className="text-muted-foreground mb-4">Reconciliation not found</p>
        <Button onClick={onBack}>Go Back</Button>
      </div>
    );
  }

  const { reconciliation, items } = detail;
  const itemsWithVariance = items.filter((item: any) => item.variance !== null && item.variance !== 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-2xl font-bold">
              Reconciliation Report - {format(new Date(reconciliation.reconciliation_date), 'MMM d, yyyy')}
            </h2>
          </div>
        </div>
        <Button variant="outline" onClick={() => exportReconciliationCSV(reconciliationId)}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items Counted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reconciliation.total_items_counted}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items with Variance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reconciliation.items_with_variance}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Impact</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${reconciliation.total_shrinkage_value < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {reconciliation.total_shrinkage_value < 0 ? '-' : '+'}${Math.abs(reconciliation.total_shrinkage_value).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Product</th>
                  <th className="text-right p-3 font-medium">Expected</th>
                  <th className="text-right p-3 font-medium">Actual</th>
                  <th className="text-right p-3 font-medium">Variance</th>
                  <th className="text-right p-3 font-medium">Value Impact</th>
                  <th className="text-left p-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3">
                      <div>
                        <div className="font-medium">{item.product.name}</div>
                        <div className="text-sm text-muted-foreground">{item.product.sku}</div>
                      </div>
                    </td>
                    <td className="text-right p-3">{item.expected_quantity}</td>
                    <td className="text-right p-3">
                      {item.actual_quantity !== null ? item.actual_quantity : '-'}
                    </td>
                    <td className="text-right p-3">
                      {item.variance !== null ? (
                        <span className={item.variance === 0 ? '' : item.variance < 0 ? 'text-red-600' : 'text-green-600'}>
                          {item.variance > 0 ? '+' : ''}{item.variance}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="text-right p-3">
                      {item.variance_value !== null ? (
                        <span className={item.variance_value === 0 ? '' : item.variance_value < 0 ? 'text-red-600' : 'text-green-600'}>
                          {item.variance_value > 0 ? '+' : ''}${item.variance_value.toFixed(2)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{item.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
