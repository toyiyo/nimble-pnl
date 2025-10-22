import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategorySelector } from "@/components/CategorySelector";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { BankAccountInfo } from "./BankAccountInfo";
import { TransactionBadges } from "./TransactionBadges";

interface Transaction {
  id: string;
  transaction_date: string;
  description?: string;
  merchant_name?: string;
  amount: number;
  status: string;
  is_categorized: boolean;
  is_split: boolean;
  category_id?: string;
  connected_bank?: {
    institution_name: string;
    bank_account_balances?: Array<{
      account_mask?: string;
      account_name?: string;
    }>;
  };
  chart_account?: {
    account_name: string;
  };
}

interface TransactionCardProps {
  transaction: Transaction;
  onCategorize: (transactionId: string, categoryId: string) => void;
  restaurantId: string;
  formatDate: (date: string) => string;
  formatCurrency: (amount: number) => string;
}

export function TransactionCard({ 
  transaction, 
  onCategorize, 
  restaurantId,
  formatDate,
  formatCurrency 
}: TransactionCardProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const isNegative = transaction.amount < 0;

  return (
    <>
      <Card 
        className={cn(
          "transition-all hover:shadow-md w-full max-w-full",
          !transaction.is_categorized && "border-l-4 border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20"
        )}
      >
        <CardContent className="p-4 space-y-3 w-full max-w-full overflow-hidden">
          {/* Header: Date and Amount */}
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-sm font-medium text-muted-foreground">
                {formatDate(transaction.transaction_date)}
              </p>
              <h4 className="font-semibold text-base truncate mt-1">
                {transaction.merchant_name || transaction.description}
              </h4>
              {transaction.merchant_name && transaction.description !== transaction.merchant_name && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {transaction.description}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div className={cn(
                "text-lg font-bold whitespace-nowrap",
                isNegative ? "text-red-500" : "text-green-500"
              )}>
                {formatCurrency(transaction.amount)}
              </div>
              <Badge 
                variant={transaction.status === 'posted' ? 'default' : 'secondary'} 
                className="mt-1 text-xs"
              >
                {transaction.status}
              </Badge>
            </div>
          </div>

          {/* Bank Info */}
          <BankAccountInfo
            institutionName={transaction.connected_bank?.institution_name}
            accountMask={transaction.connected_bank?.bank_account_balances?.[0]?.account_mask}
            showIcon={true}
            className="text-muted-foreground"
          />

          {/* Category Selector or Split Indicator */}
          <div className="space-y-2 w-full">
            <TransactionBadges
              isSplit={transaction.is_split}
            />
            {transaction.is_split ? null : (
              <CategorySelector
                restaurantId={restaurantId}
                value={transaction.category_id}
                onSelect={(categoryId) => onCategorize(transaction.id, categoryId)}
              />
            )}
            {!transaction.is_categorized && !transaction.is_split && (
              <Badge 
                variant="outline" 
                className="text-xs bg-yellow-100 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-800 w-fit"
              >
                Needs categorization
              </Badge>
            )}
          </div>

          {/* View Details Button */}
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-between mt-2"
            onClick={() => setIsDetailOpen(true)}
          >
            <span>View Details</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
      
      <TransactionDetailSheet
        transaction={transaction as any}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />
    </>
  );
}
