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
      <DialogContent className="max-w-3xl max-h-[90vh] w-[95vw] sm:w-full p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Manual Match Transaction</DialogTitle>
          <DialogDescription className="text-sm">
            Match with: <strong className="break-words">{pendingOutflow.vendor_name}</strong> - {formatCurrency(pendingOutflow.amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
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
          <ScrollArea className="h-[50vh] sm:h-[450px] border rounded-lg">
            <div className="p-2 sm:p-4 space-y-2">
              {isLoading ? (
                <div className="text-center text-muted-foreground py-8 text-sm">Loading transactions...</div>
              ) : availableTransactions.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  No uncategorized transactions found
                </div>
              ) : (
                availableTransactions.map((transaction) => (
                  <button
                    key={transaction.id}
                    onClick={() => setSelectedTransactionId(transaction.id)}
                    className={`w-full p-3 sm:p-4 rounded-lg border text-left transition-all hover:border-primary/50 ${
                      selectedTransactionId === transaction.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground text-sm sm:text-base truncate">
                          {transaction.merchant_name || transaction.description}
                        </div>
                        {transaction.merchant_name && transaction.description && (
                          <div className="text-xs sm:text-sm text-muted-foreground truncate">
                            {transaction.description}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span className="text-xs">{format(new Date(transaction.transaction_date), 'MMM d, yyyy')}</span>
                          </span>
                          {transaction.connected_bank?.institution_name && (
                            <span className="truncate text-xs">
                              {transaction.connected_bank.institution_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2 shrink-0 self-start">
                        <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                        <span className="font-semibold text-foreground text-sm sm:text-base whitespace-nowrap">
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
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button 
              onClick={handleConfirm}
              disabled={!selectedTransactionId || confirmMatch.isPending}
              className="w-full sm:w-auto"
            >
              {confirmMatch.isPending ? 'Confirming...' : 'Confirm Match'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
