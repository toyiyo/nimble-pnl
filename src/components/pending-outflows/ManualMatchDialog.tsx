import { useState, useMemo } from 'react';
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

  // Filter to uncategorized, negative transactions only with enhanced search
  const availableTransactions = useMemo(() => {
    if (!transactions) return [];
    
    const searchLower = searchTerm.toLowerCase().trim();
    
    return transactions
      .filter(t => {
        if (t.is_categorized || t.amount >= 0) return false;
        
        if (!searchLower) return true;
        
        // Search by merchant name, description, payee
        const textMatch = 
          t.merchant_name?.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.normalized_payee?.toLowerCase().includes(searchLower);
        
        // Search by amount (support formats like "100", "100.50", "$100")
        const amountStr = Math.abs(t.amount).toFixed(2);
        const amountMatch = amountStr.includes(searchLower.replace('$', ''));
        
        // Search by date (support formats like "2024", "Jan", "January", "01/15")
        const dateStr = format(new Date(t.transaction_date), 'MMM d, yyyy').toLowerCase();
        const dateISOStr = format(new Date(t.transaction_date), 'yyyy-MM-dd');
        const dateMatch = dateStr.includes(searchLower) || dateISOStr.includes(searchLower);
        
        return textMatch || amountMatch || dateMatch;
      })
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [transactions, searchTerm]);

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
      <DialogContent className="max-w-3xl h-[90vh] w-[95vw] sm:w-full p-0 flex flex-col gap-0">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 shrink-0">
          <DialogTitle className="text-lg sm:text-xl">Manual Match Transaction</DialogTitle>
          <DialogDescription className="text-sm break-words">
            Match with: <strong className="break-words">{pendingOutflow.vendor_name}</strong> - {formatCurrency(pendingOutflow.amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 gap-4">
          {/* Enhanced Search */}
          <div className="shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by payee, description, date, or amount..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                aria-label="Search transactions"
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1 px-1">
              Try: payee name, date (e.g., "Jan 15"), or amount (e.g., "100.50")
            </div>
          </div>

          {/* Scrollable Transaction List */}
          <div className="flex-1 min-h-0 border rounded-lg">
            <ScrollArea className="h-full">
              <div className="p-2 sm:p-4 space-y-2">
                {isLoading ? (
                  <div className="text-center text-muted-foreground py-8 text-sm">Loading transactions...</div>
                ) : availableTransactions.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8 text-sm">
                    {searchTerm ? 'No transactions match your search' : 'No uncategorized transactions found'}
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
                      <div className="flex flex-col gap-2">
                        {/* Top row: Description and Amount */}
                        <div className="flex items-start justify-between gap-4 w-full">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground text-sm sm:text-base truncate">
                              {transaction.merchant_name || transaction.description}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 min-w-[110px] justify-end">
                            <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-semibold text-foreground text-base whitespace-nowrap">
                              {formatCurrency(transaction.amount)}
                            </span>
                          </div>
                        </div>
                        
                        {/* Second row: Secondary description if present */}
                        {transaction.merchant_name && transaction.description && (
                          <div className="text-xs sm:text-sm text-muted-foreground truncate">
                            {transaction.description}
                          </div>
                        )}
                        
                        {/* Third row: Date and Bank */}
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 whitespace-nowrap shrink-0">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span>{format(new Date(transaction.transaction_date), 'MMM d, yyyy')}</span>
                          </span>
                          {transaction.connected_bank?.institution_name && (
                            <span className="truncate min-w-0">
                              {transaction.connected_bank.institution_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 px-4 sm:px-6 py-4 border-t shrink-0">
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
      </DialogContent>
    </Dialog>
  );
};
