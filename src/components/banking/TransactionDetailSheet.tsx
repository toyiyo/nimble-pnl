import { useState, useEffect } from "react";
import { format } from "date-fns";
import { BankTransaction, useCategorizeTransaction } from "@/hooks/useBankTransactions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { SearchableAccountSelector } from "./SearchableAccountSelector";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Building2, Calendar, DollarSign, FileText, Sparkles, Split } from "lucide-react";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { SupplierSuggestion } from "./SupplierSuggestion";

interface TransactionDetailSheetProps {
  transaction: BankTransaction;
  isOpen: boolean;
  onClose: () => void;
}

export function TransactionDetailSheet({
  transaction,
  isOpen,
  onClose,
}: TransactionDetailSheetProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    transaction.category_id || transaction.suggested_category_id || ''
  );
  const [description, setDescription] = useState(transaction.notes || '');
  const [payee, setPayee] = useState(
    transaction.normalized_payee || transaction.merchant_name || ''
  );
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | undefined>(
    transaction.supplier_id
  );

  // Reset state when transaction changes
  useEffect(() => {
    setSelectedCategoryId(transaction.category_id || transaction.suggested_category_id || '');
    setDescription(transaction.notes || '');
    setPayee(transaction.normalized_payee || transaction.merchant_name || '');
    setSelectedSupplierId(transaction.supplier_id);
  }, [transaction.id, transaction.category_id, transaction.suggested_category_id, transaction.notes, transaction.normalized_payee, transaction.merchant_name, transaction.supplier_id]);

  const categorize = useCategorizeTransaction();
  const { selectedRestaurant } = useRestaurantContext();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || '');

  // Fetch split details if transaction is split
  const { data: splits } = useQuery({
    queryKey: ['transaction-splits', transaction.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_transaction_splits')
        .select('*, category:chart_of_accounts(account_name, account_code)')
        .eq('transaction_id', transaction.id);
      
      if (error) throw error;
      return data;
    },
    enabled: !!transaction.is_split,
  });

  // Fetch supplier suggestions based on payee name
  const { data: supplierSuggestions } = useQuery({
    queryKey: ['supplier-suggestions', payee, selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!payee || payee.length < 2) return [];
      
      const { data, error } = await supabase.rpc('suggest_supplier_for_payee', {
        p_restaurant_id: selectedRestaurant?.restaurant_id,
        p_payee_name: payee
      });
      
      if (error) throw error;
      return data;
    },
    enabled: !!payee && !!selectedRestaurant?.restaurant_id && !transaction.is_split,
  });

  const isNegative = transaction.amount < 0;
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(transaction.amount));

  const selectedAccount = accounts?.find(a => a.id === selectedCategoryId);

  // Show suggestion if available
  const hasSuggestion = transaction.suggested_category_id && transaction.match_confidence;
  
  useEffect(() => {
    // Auto-select suggested category if available and no category is selected
    if (hasSuggestion && !transaction.category_id) {
      setSelectedCategoryId(transaction.suggested_category_id || '');
    }
  }, [hasSuggestion, transaction.category_id, transaction.suggested_category_id]);

  const handleSave = async () => {
    if (!selectedCategoryId) return;

    await categorize.mutateAsync({
      transactionId: transaction.id,
      categoryId: selectedCategoryId,
      description: description || undefined,
      normalizedPayee: payee || undefined,
      supplierId: selectedSupplierId,
    });

    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Transaction Details</SheetTitle>
          <SheetDescription>
            Review and categorize this transaction
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Transaction Info */}
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${isNegative ? 'text-destructive' : 'text-green-600'}`}>
                    {isNegative ? '-' : '+'}{formattedAmount}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {isNegative ? 'Payment' : 'Deposit'}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {transaction.is_transfer && (
                  <Badge variant="secondary">
                    <ArrowLeftRight className="h-3 w-3 mr-1" />
                    Transfer
                  </Badge>
                )}
                {transaction.is_split && (
                  <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                    <Split className="h-3 w-3 mr-1" />
                    Split
                  </Badge>
                )}
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Date
                </div>
                <div className="font-medium">
                  {format(new Date(transaction.transaction_date), 'MMMM dd, yyyy')}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  Status
                </div>
                <div>
                  <Badge variant={
                    transaction.status === 'categorized' ? 'default' :
                    transaction.status === 'excluded' ? 'secondary' :
                    'outline'
                  }>
                    {transaction.status.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Description</div>
              <div className="text-sm p-3 bg-muted rounded-md">
                {transaction.description}
              </div>
            </div>

            {/* Split Transaction Details */}
            {transaction.is_split && splits && splits.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Split className="h-4 w-4" />
                  Split Breakdown
                </div>
                <div className="space-y-2">
                  {splits.map((split: any, index: number) => (
                    <div 
                      key={split.id} 
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md border"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {split.category?.account_name || 'Unknown Category'}
                        </div>
                        {split.category?.account_code && (
                          <div className="text-xs text-muted-foreground">
                            {split.category.account_code}
                          </div>
                        )}
                        {split.description && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {split.description}
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-semibold">
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                        }).format(split.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Edit Form - Only show if not split */}
          {!transaction.is_split && (
            <div className="space-y-4">
            {hasSuggestion && (
              <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">AI Suggestion</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Based on your categorization history
                      {transaction.match_confidence && (
                        <span className="ml-1">
                          ({Math.round(transaction.match_confidence * 100)}% confidence)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="payee">Payee</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="payee"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="Enter payee name"
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <SearchableAccountSelector
                value={selectedCategoryId}
                onValueChange={setSelectedCategoryId}
                placeholder="Select category"
              />
              {selectedAccount && (
                <div className="text-xs text-muted-foreground">
                  {selectedAccount.account_code} • {selectedAccount.account_type}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add any additional notes"
                rows={3}
              />
            </div>

            {/* Supplier Suggestions */}
            {supplierSuggestions && supplierSuggestions.length > 0 && (
              <>
                <Separator />
                <SupplierSuggestion
                  suggestions={supplierSuggestions}
                  selectedSupplierId={selectedSupplierId}
                  onSelectSupplier={setSelectedSupplierId}
                />
              </>
            )}
          </div>
          )}

          {/* Actions */}
          {!transaction.is_split ? (
            <div className="flex gap-3">
              <Button
                onClick={handleSave}
                disabled={!selectedCategoryId || categorize.isPending}
                className="flex-1"
              >
                Save & Categorize
              </Button>
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
