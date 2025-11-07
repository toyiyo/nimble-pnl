import { useState } from 'react';
import { Search, Calendar, DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBankTransactionsWithRelations } from '@/hooks/useBankTransactions';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import { format } from 'date-fns';
import { PendingOutflow } from '@/types/pending-outflows';

interface ManualMatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pendingOutflow: PendingOutflow;
  restaurantId: string;
}

export const ManualMatchDialog = ({ 
  isOpen, 
  onClose, 
  pendingOutflow,
  restaurantId 
}: ManualMatchDialogProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  
  const { data: transactions, isLoading } = useBankTransactionsWithRelations(restaurantId);
  const { confirmMatch } = usePendingOutflowMutations();

  // Filter to uncategorized, negative transactions only
  const availableTransactions = transactions
    ?.filter(t => 
      !t.is_categorized && 
      t.amount < 0 && // Outgoing transactions
      (
        t.merchant_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    )
    .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime()) || [];

  const handleConfirm = async () => {
    if (!selectedTransactionId) return;
    
    await confirmMatch.mutateAsync({
      pendingOutflowId: pendingOutflow.id,
      bankTransactionId: selectedTransactionId
    });
    
    onClose();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(amount));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Manual Match Transaction</DialogTitle>
          <DialogDescription>
            Select a transaction to match with: <strong>{pendingOutflow.vendor_name}</strong> - {formatCurrency(pendingOutflow.amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Transaction List */}
          <ScrollArea className="h-[400px] border rounded-lg">
            <div className="p-4 space-y-2">
              {isLoading ? (
                <div className="text-center text-muted-foreground py-8">Loading transactions...</div>
              ) : availableTransactions.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No uncategorized transactions found
                </div>
              ) : (
                availableTransactions.map((transaction) => (
                  <button
                    key={transaction.id}
                    onClick={() => setSelectedTransactionId(transaction.id)}
                    className={`w-full p-4 rounded-lg border text-left transition-all hover:border-primary/50 ${
                      selectedTransactionId === transaction.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {transaction.merchant_name || transaction.description}
                        </div>
                        {transaction.merchant_name && transaction.description && (
                          <div className="text-sm text-muted-foreground truncate">
                            {transaction.description}
                          </div>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(transaction.transaction_date), 'MMM d, yyyy')}
                          </span>
                          {transaction.connected_bank?.institution_name && (
                            <span className="truncate">
                              {transaction.connected_bank.institution_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold text-foreground">
                          {formatCurrency(transaction.amount)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleConfirm}
              disabled={!selectedTransactionId || confirmMatch.isPending}
            >
              {confirmMatch.isPending ? 'Confirming...' : 'Confirm Match'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
