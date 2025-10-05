import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Eye } from 'lucide-react';
import { useReconciliationHistory } from '@/hooks/useReconciliationHistory';
import { format } from 'date-fns';
import { ReconciliationReport } from './ReconciliationReport';

interface ReconciliationHistoryProps {
  restaurantId: string;
  onStartNew: () => void;
}

export function ReconciliationHistory({ restaurantId, onStartNew }: ReconciliationHistoryProps) {
  const { reconciliations, loading } = useReconciliationHistory(restaurantId);
  const [selectedReconciliationId, setSelectedReconciliationId] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Badge className="bg-green-500">Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-500">In Progress</Badge>;
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (selectedReconciliationId) {
    return (
      <ReconciliationReport
        reconciliationId={selectedReconciliationId}
        onBack={() => setSelectedReconciliationId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Inventory Reconciliation History</h2>
          <p className="text-muted-foreground">View and manage past inventory counts</p>
        </div>
        <Button onClick={onStartNew}>
          <Plus className="mr-2 h-4 w-4" />
          Start New Count
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Loading reconciliations...
          </CardContent>
        </Card>
      ) : reconciliations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground mb-4">
              <p className="text-lg font-medium">No reconciliations yet</p>
              <p className="text-sm">Start your first inventory count to track variances and maintain accurate stock levels</p>
            </div>
            <Button onClick={onStartNew}>
              <Plus className="mr-2 h-4 w-4" />
              Start First Count
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Date</th>
                <th className="text-left p-3 font-medium">Performed By</th>
                <th className="text-right p-3 font-medium">Items Counted</th>
                <th className="text-right p-3 font-medium">Variances</th>
                <th className="text-right p-3 font-medium">Total Impact</th>
                <th className="text-center p-3 font-medium">Status</th>
                <th className="text-center p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.map((rec) => (
                <tr key={rec.id} className="border-t hover:bg-muted/50">
                  <td className="p-3">
                    {format(new Date(rec.reconciliation_date), 'MMM d, yyyy')}
                  </td>
                  <td className="p-3">
                    {rec.performer?.full_name || rec.performer?.email || 'Unknown User'}
                  </td>
                  <td className="text-right p-3">{rec.total_items_counted}</td>
                  <td className="text-right p-3">{rec.items_with_variance}</td>
                  <td className="text-right p-3">
                    <span className={rec.total_shrinkage_value < 0 ? 'text-red-600' : 'text-green-600'}>
                      {rec.total_shrinkage_value < 0 ? '-' : '+'}${Math.abs(rec.total_shrinkage_value).toFixed(2)}
                    </span>
                  </td>
                  <td className="text-center p-3">{getStatusBadge(rec.status)}</td>
                  <td className="text-center p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedReconciliationId(rec.id)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
