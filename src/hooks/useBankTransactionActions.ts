import { useState } from 'react';
import { BankTransaction, useCategorizeTransaction, useDeleteTransaction } from '@/hooks/useBankTransactions';
import { ChartAccount } from '@/hooks/useChartOfAccounts';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useReconcileTransaction, useUnreconcileTransaction } from '@/hooks/useBankReconciliation';
import { useDateFormat } from '@/hooks/useDateFormat';

export interface TransactionActionsState {
  isDetailOpen: boolean;
  isSplitOpen: boolean;
  showRulesDialog: boolean;
  showDeleteConfirm: boolean;
  setIsDetailOpen: (open: boolean) => void;
  setIsSplitOpen: (open: boolean) => void;
  setShowRulesDialog: (open: boolean) => void;
  setShowDeleteConfirm: (open: boolean) => void;
}

export interface TransactionComputedValues {
  isNegative: boolean;
  formattedAmount: string;
  suggestedCategory: ChartAccount | undefined;
  currentCategory: ChartAccount | undefined;
  hasSuggestion: boolean;
}

export interface TransactionMutations {
  categorize: ReturnType<typeof useCategorizeTransaction>;
  deleteTransaction: ReturnType<typeof useDeleteTransaction>;
  reconcile: ReturnType<typeof useReconcileTransaction>;
  unreconcile: ReturnType<typeof useUnreconcileTransaction>;
}

export interface PrefilledRuleData {
  ruleName: string;
  appliesTo: 'bank_transactions';
  descriptionPattern: string;
  descriptionMatchType: 'contains';
  supplierId: string;
  transactionType: 'debit' | 'credit';
  categoryId: string;
  priority: string;
  autoApply: boolean;
  minAmount: string;
  maxAmount: string;
}

export interface UseBankTransactionActionsReturn {
  state: TransactionActionsState;
  computed: TransactionComputedValues;
  mutations: TransactionMutations;
  formatTransactionDate: ReturnType<typeof useDateFormat>['formatTransactionDate'];
  handleQuickAccept: () => void;
  handleDeleteClick: () => void;
  handleDeleteConfirm: () => void;
  handleCreateRule: () => void;
  getPrefilledRuleData: () => PrefilledRuleData;
}

export function useBankTransactionActions(
  transaction: BankTransaction,
  accounts: ChartAccount[]
): UseBankTransactionActionsReturn {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { selectedRestaurant } = useRestaurantContext();
  const categorize = useCategorizeTransaction();
  const deleteTransaction = useDeleteTransaction();
  const reconcile = useReconcileTransaction();
  const unreconcile = useUnreconcileTransaction();
  const { formatTransactionDate } = useDateFormat();

  // Computed values
  const isNegative = transaction.amount < 0;
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(transaction.amount));

  const suggestedCategory = accounts?.find(a => a.id === transaction.suggested_category_id);
  const currentCategory = accounts?.find(a => a.id === transaction.category_id);
  const hasSuggestion = !transaction.is_categorized && !!suggestedCategory;

  // Handlers
  const handleQuickAccept = () => {
    if (transaction.suggested_category_id) {
      categorize.mutate({
        transactionId: transaction.id,
        categoryId: transaction.suggested_category_id,
      });
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    if (!selectedRestaurant?.restaurant_id) return;
    deleteTransaction.mutate({
      transactionId: transaction.id,
      restaurantId: selectedRestaurant.restaurant_id,
    }, {
      onSettled: () => {
        setShowDeleteConfirm(false);
      },
    });
  };

  const handleCreateRule = () => {
    setShowRulesDialog(true);
  };

  const getPrefilledRuleData = (): PrefilledRuleData => {
    const merchantName = transaction.merchant_name || transaction.normalized_payee;
    const description = transaction.description?.trim() || '';
    const isExpense = transaction.amount < 0;
    const amount = Math.abs(transaction.amount);

    // Check if description is too generic to use as pattern
    const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer', 'debit', 'credit', 'ach', 'wire'];
    const isGenericDescription = genericTerms.some(term =>
      description.toLowerCase() === term.toLowerCase()
    );

    // Use merchant name if available and specific (length >= 3)
    const hasSpecificMerchant = merchantName && merchantName.length >= 3 &&
      !genericTerms.some(term => merchantName.toLowerCase() === term.toLowerCase());

    // For recurring amounts (like salaries), suggest amount range
    const isLikelyRecurring = amount > 0 && amount >= 100 && Number.isInteger(amount * 100);
    const shouldSuggestAmountRange = isLikelyRecurring && !hasSpecificMerchant;

    return {
      ruleName: hasSpecificMerchant
        ? `Auto-categorize ${merchantName.substring(0, 30)}${merchantName.length > 30 ? '...' : ''}`
        : 'Transaction categorization rule',
      appliesTo: 'bank_transactions' as const,
      descriptionPattern: hasSpecificMerchant ? merchantName : '',
      descriptionMatchType: 'contains' as const,
      supplierId: transaction.supplier?.id || '',
      transactionType: (isExpense ? 'debit' : 'credit') as 'debit' | 'credit',
      categoryId: transaction.category_id || transaction.suggested_category_id || '',
      priority: '5',
      autoApply: true,
      minAmount: shouldSuggestAmountRange ? (amount * 0.95).toFixed(2) : '',
      maxAmount: shouldSuggestAmountRange ? (amount * 1.05).toFixed(2) : '',
    };
  };

  return {
    state: {
      isDetailOpen,
      isSplitOpen,
      showRulesDialog,
      showDeleteConfirm,
      setIsDetailOpen,
      setIsSplitOpen,
      setShowRulesDialog,
      setShowDeleteConfirm,
    },
    computed: {
      isNegative,
      formattedAmount,
      suggestedCategory,
      currentCategory,
      hasSuggestion,
    },
    mutations: {
      categorize,
      deleteTransaction,
      reconcile,
      unreconcile,
    },
    formatTransactionDate,
    handleQuickAccept,
    handleDeleteClick,
    handleDeleteConfirm,
    handleCreateRule,
    getPrefilledRuleData,
  };
}
