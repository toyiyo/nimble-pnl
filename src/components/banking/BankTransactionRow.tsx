import { useMemo } from "react";
import { BankTransaction } from "@/hooks/useBankTransactions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Edit, Trash2, FileText, Split, CheckCircle2, MoreVertical, Sparkles, Settings2 } from "lucide-react";
import { BankAccountInfo } from "./BankAccountInfo";
import { TransactionBadges } from "./TransactionBadges";
import { TransactionDialogs } from "./TransactionDialogs";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useBankTransactionActions } from "@/hooks/useBankTransactionActions";
import { AIConfidenceBadge } from "./AIConfidenceBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BankTransactionRowProps {
  transaction: BankTransaction;
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelectionToggle?: (id: string, event: React.MouseEvent) => void;
}

// Column widths - must match BankTransactionList header
const COLUMN_WIDTHS = {
  checkbox: 'w-[50px]',
  date: 'w-[110px]',
  description: 'flex-1 min-w-[180px]',
  payee: 'w-[120px] hidden md:block',
  bankAccount: 'w-[140px] hidden lg:block',
  amount: 'w-[100px] text-right',
  category: 'w-[140px] hidden lg:block',
  reason: 'w-[120px] hidden lg:block',
  actions: 'w-[60px] text-right',
};

export function BankTransactionRow({
  transaction,
  status,
  accounts,
  isSelectionMode = false,
  isSelected = false,
  onSelectionToggle,
}: BankTransactionRowProps) {
  const {
    state,
    computed,
    mutations,
    formatTransactionDate,
    handleQuickAccept,
    handleDeleteClick,
    handleDeleteConfirm,
    handleCreateRule,
    getPrefilledRuleData,
  } = useBankTransactionActions(transaction, accounts);

  const { isDetailOpen, isSplitOpen, showRulesDialog, showDeleteConfirm, setIsDetailOpen, setIsSplitOpen, setShowRulesDialog, setShowDeleteConfirm } = state;
  const { isNegative, formattedAmount, suggestedCategory, currentCategory, hasSuggestion } = computed;
  const { categorize, deleteTransaction, reconcile, unreconcile } = mutations;

  // Note: bank_account_balances and raw_data are no longer fetched in list queries for performance
  // Account mask will only show when full transaction details are loaded (e.g., in detail dialog)
  const transactionAccount = useMemo(() => {
    // If bank_account_balances is available (e.g., from detail query), find the matching account
    const balances = (transaction.connected_bank as { bank_account_balances?: Array<{ stripe_financial_account_id: string | null; account_mask: string | null }> })?.bank_account_balances;
    if (!balances) return undefined;

    const rawData = (transaction as { raw_data?: { account?: string } }).raw_data;
    const stripeAccountId = rawData?.account;
    return balances.find(bal => bal.stripe_financial_account_id === stripeAccountId);
  }, [transaction]);

  const handleRowClick = (event: React.MouseEvent) => {
    if (isSelectionMode && onSelectionToggle) {
      onSelectionToggle(transaction.id, event);
    }
  };

  return (
    <>
      {/* Div-based row for virtualization compatibility */}
      <div
        data-testid="bank-transaction-row"
        className={`
          flex items-center gap-2 px-4 py-3 border-b text-sm
          ${hasSuggestion ? 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/40 border-l-4 border-l-amber-500 dark:border-l-amber-600' : 'hover:bg-muted/50'}
          ${isSelected ? 'bg-primary/10 border-l-4 border-l-primary' : ''}
          ${isSelectionMode ? 'cursor-pointer' : ''}
        `}
        onClick={handleRowClick}
      >
        {/* Checkbox column (only in selection mode) */}
        {isSelectionMode && (
          <div className={COLUMN_WIDTHS.checkbox} onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onSelectionToggle?.(transaction.id, {} as React.MouseEvent)}
              aria-label={`Select transaction ${transaction.description}`}
            />
          </div>
        )}

        {/* Date column */}
        <div className={`${COLUMN_WIDTHS.date} font-medium`}>
          {formatTransactionDate(transaction.transaction_date, 'MMM dd, yyyy')}
        </div>

        {/* Description column */}
        <div className={COLUMN_WIDTHS.description}>
          <div className="flex flex-col">
            <span className="font-medium truncate">{transaction.description}</span>
            <TransactionBadges
              isTransfer={transaction.is_transfer}
              isSplit={transaction.is_split}
              className="mt-1"
            />
          </div>
        </div>

        {/* Payee column */}
        <div className={COLUMN_WIDTHS.payee}>
          <div className="flex flex-col gap-1">
            <span className="truncate">{transaction.normalized_payee || transaction.merchant_name || '—'}</span>
            {transaction.supplier && (
              <TransactionBadges supplierName={transaction.supplier.name} />
            )}
          </div>
        </div>

        {/* Bank Account column */}
        <div className={COLUMN_WIDTHS.bankAccount}>
          <BankAccountInfo
            institutionName={transaction.connected_bank?.institution_name}
            accountMask={transactionAccount?.account_mask}
            showIcon={false}
            layout="stacked"
          />
        </div>

        {/* Amount column */}
        <div className={COLUMN_WIDTHS.amount}>
          <div className="flex items-center justify-end gap-2">
            <span className={isNegative ? "text-destructive" : "text-success"}>
              {isNegative ? '-' : '+'}{formattedAmount}
            </span>
            {transaction.is_reconciled && (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
        </div>

        {/* Category column (for_review status) */}
        {status === 'for_review' && (
          <div className={COLUMN_WIDTHS.category}>
            {transaction.is_categorized && currentCategory ? (
              <Badge
                variant="outline"
                className="bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-50 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                {currentCategory.account_name}
              </Badge>
            ) : suggestedCategory ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className="bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-50 border-amber-400 dark:border-amber-600 hover:bg-amber-200 dark:hover:bg-amber-800"
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  {suggestedCategory.account_name}
                </Badge>
                {transaction.ai_confidence && (
                  <AIConfidenceBadge
                    confidence={transaction.ai_confidence}
                    reasoning={transaction.ai_reasoning}
                  />
                )}
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">Uncategorized</span>
            )}
          </div>
        )}

        {/* Category column (categorized status) */}
        {status === 'categorized' && (
          <div className={COLUMN_WIDTHS.category}>
            {transaction.is_split ? (
              <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                <Split className="h-3 w-3 mr-1" />
                Split across categories
              </Badge>
            ) : currentCategory ? (
              <Badge
                variant="outline"
                className="bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-50 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                {currentCategory.account_name}
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        )}

        {/* Reason column (excluded status) */}
        {status === 'excluded' && (
          <div className={COLUMN_WIDTHS.reason}>
            <span className="text-sm text-muted-foreground">
              {transaction.excluded_reason || 'Excluded'}
            </span>
          </div>
        )}

        {/* Actions column */}
        <div className={COLUMN_WIDTHS.actions}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-background z-50">
              {status === 'for_review' && (
                <>
                  {transaction.suggested_category_id && (
                    <DropdownMenuItem
                      onClick={handleQuickAccept}
                      disabled={categorize.isPending}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Accept Suggestion
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsSplitOpen(true)}>
                    <Split className="h-4 w-4 mr-2" />
                    Split Transaction
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCreateRule}>
                    <Settings2 className="h-4 w-4 mr-2" />
                    Create Rule
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDeleteClick}
                    disabled={deleteTransaction.isPending}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
              {status === 'categorized' && (
                <>
                  <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
                    <FileText className="h-4 w-4 mr-2" />
                    View Details
                  </DropdownMenuItem>
                  {transaction.is_reconciled ? (
                    <DropdownMenuItem
                      onClick={() => unreconcile.mutate({ transactionId: transaction.id })}
                      disabled={unreconcile.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
                      Unreconcile
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => reconcile.mutate({ transactionId: transaction.id })}
                      disabled={reconcile.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark as Reconciled
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {status === 'excluded' && (
                <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  View Details
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <TransactionDialogs
        transaction={transaction}
        isDetailOpen={isDetailOpen}
        onDetailClose={() => setIsDetailOpen(false)}
        isSplitOpen={isSplitOpen}
        onSplitClose={() => setIsSplitOpen(false)}
        showRulesDialog={showRulesDialog}
        onRulesDialogChange={setShowRulesDialog}
        prefilledRule={getPrefilledRuleData()}
        showDeleteConfirm={showDeleteConfirm}
        onDeleteConfirmChange={setShowDeleteConfirm}
        onDeleteConfirm={handleDeleteConfirm}
        isDeleting={deleteTransaction.isPending}
      />
    </>
  );
}
