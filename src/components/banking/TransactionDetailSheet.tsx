import { useState } from "react";
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
import { ArrowLeftRight, Building2, Calendar, DollarSign, FileText } from "lucide-react";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

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

  const categorize = useCategorizeTransaction();
  const { selectedRestaurant } = useRestaurantContext();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || '');

  const isNegative = transaction.amount < 0;
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(transaction.amount));

  const selectedAccount = accounts?.find(a => a.id === selectedCategoryId);

  const handleSave = async () => {
    if (!selectedCategoryId) return;

    await categorize.mutateAsync({
      transactionId: transaction.id,
      categoryId: selectedCategoryId,
      description: description || undefined,
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
              {transaction.is_transfer && (
                <Badge variant="secondary">
                  <ArrowLeftRight className="h-3 w-3 mr-1" />
                  Transfer
                </Badge>
              )}
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
          </div>

          <Separator />

          {/* Edit Form */}
          <div className="space-y-4">
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
          </div>

          {/* Actions */}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
