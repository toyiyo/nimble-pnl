import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBankTransactions, BankTransaction } from "@/hooks/useBankTransactions";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useConnectedBanks } from "@/hooks/useConnectedBanks";
import { useOpeningBalance } from "@/hooks/useOpeningBalance";
import { useReconcileTransactions } from "@/hooks/useReconcileTransactions";
import { format } from "date-fns";
import { CalendarIcon, CheckCircle2, AlertCircle, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateInTimezone } from "@/lib/timezone";
import { toast } from "sonner";

interface EnhancedReconciliationDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ReconciliationStep = 'setup' | 'matching' | 'complete';

export function EnhancedReconciliationDialog({ isOpen, onClose }: EnhancedReconciliationDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  
  // Step state
  const [step, setStep] = useState<ReconciliationStep>('setup');
  
  // Setup form state
  const [selectedAccountBalanceId, setSelectedAccountBalanceId] = useState<string>("");
  const [endingDate, setEndingDate] = useState<Date>();
  const [endingBalance, setEndingBalance] = useState("");
  const [interestEarned, setInterestEarned] = useState("0.00");
  const [serviceCharges, setServiceCharges] = useState("0.00");
  
  // Matching state
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());

  // Fetch connected bank accounts
  const { data: connectedBanks } = useConnectedBanks(selectedRestaurant?.restaurant_id, isOpen);
  
  // Flatten all bank account balances from all connected banks
  const bankAccountBalances = useMemo(() => {
    if (!connectedBanks) return [];
    
    return connectedBanks.flatMap(bank => 
      (bank.bank_account_balances || []).map(balance => ({
        id: balance.id,
        connectedBankId: bank.id,
        institutionName: bank.institution_name,
        accountName: balance.account_name,
        accountMask: balance.account_mask,
      }))
    );
  }, [connectedBanks]);
  
  // Get the selected account balance details
  const selectedAccount = useMemo(() => {
    return bankAccountBalances.find(acc => acc.id === selectedAccountBalanceId);
  }, [bankAccountBalances, selectedAccountBalanceId]);

  // Fetch categorized (but not yet reconciled) transactions
  const { data: categorizedTransactions } = useBankTransactions('categorized');
  
  // Filter transactions for selected account and before ending date
  const eligibleTransactions = useMemo(() => {
    if (!categorizedTransactions || !selectedAccountBalanceId || !selectedAccount || !endingDate) {
      console.log('[RECONCILIATION] No data to filter:', { 
        hasCategorized: !!categorizedTransactions,
        categorizedCount: categorizedTransactions?.length,
        hasAccountBalanceId: !!selectedAccountBalanceId,
        hasSelectedAccount: !!selectedAccount,
        hasEndingDate: !!endingDate 
      });
      return [];
    }
    
    const timezone = selectedRestaurant?.restaurant?.timezone || 'America/Chicago';
    const endingDateStr = formatDateInTimezone(endingDate, timezone, 'yyyy-MM-dd');
    
    console.log('[RECONCILIATION] Filtering transactions:', {
      totalCategorized: categorizedTransactions.length,
      selectedAccountBalanceId,
      connectedBankId: selectedAccount.connectedBankId,
      endingDate: endingDate.toISOString(),
      endingDateStr,
      timezone,
      sampleTransaction: categorizedTransactions[0],
    });
    
    const filtered = categorizedTransactions.filter(t => {
      const matchesBank = t.connected_bank_id === selectedAccount.connectedBankId;
      const notReconciled = !t.is_reconciled;
      const txnDateStr = formatDateInTimezone(t.transaction_date, timezone, 'yyyy-MM-dd');
      const beforeDate = txnDateStr <= endingDateStr;
      
      if (!matchesBank || !notReconciled || !beforeDate) {
        console.log('[RECONCILIATION] Transaction filtered out:', {
          id: t.id,
          description: t.description,
          connected_bank_id: t.connected_bank_id,
          selectedConnectedBankId: selectedAccount.connectedBankId,
          matchesBank,
          is_reconciled: t.is_reconciled,
          notReconciled,
          transaction_date: t.transaction_date,
          txnDateStr,
          endingDateStr,
          beforeDate
        });
      }
      
      return matchesBank && notReconciled && beforeDate;
    });
    
    console.log('[RECONCILIATION] Filtered result:', {
      eligibleCount: filtered.length,
      sampleEligible: filtered[0]
    });
    
    return filtered;
  }, [categorizedTransactions, selectedAccountBalanceId, selectedAccount, endingDate, selectedRestaurant]);

  // Calculate balances
  const selectedBalance = useMemo(() => {
    let total = 0;
    selectedTransactions.forEach(txnId => {
      const txn = eligibleTransactions.find(t => t.id === txnId);
      if (txn) total += Number(txn.amount);
    });
    return total;
  }, [selectedTransactions, eligibleTransactions]);

  const adjustedStatementBalance = useMemo(() => {
    const ending = parseFloat(endingBalance) || 0;
    const interest = parseFloat(interestEarned) || 0;
    const charges = parseFloat(serviceCharges) || 0;
    return ending + interest - charges;
  }, [endingBalance, interestEarned, serviceCharges]);

  // Get the last reconciled balance for this account (opening balance)
  const { data: accountBalance } = useOpeningBalance(
    selectedAccountBalanceId, 
    endingDate, 
    step === 'matching'
  );

  const openingBalance = accountBalance || 0;
  const calculatedBalance = openingBalance + selectedBalance;
  const difference = adjustedStatementBalance - calculatedBalance;

  const handleStartReconciliation = () => {
    if (!selectedAccountBalanceId || !endingDate || !endingBalance) {
      toast.error("Please fill in all required fields");
      return;
    }
    setStep('matching');
  };

  const handleToggleTransaction = (txnId: string) => {
    setSelectedTransactions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(txnId)) {
        newSet.delete(txnId);
      } else {
        newSet.add(txnId);
      }
      return newSet;
    });
  };

  const reconcileTransactionsMutation = useReconcileTransactions();

  const handleFinish = async () => {
    if (Math.abs(difference) > 0.01) {
      toast.error("Cannot finish reconciliation. The difference must be $0.00");
      return;
    }

    if (!selectedAccountBalanceId || !endingDate) {
      toast.error("Missing required information");
      return;
    }

    try {
      await reconcileTransactionsMutation.mutateAsync({
        transactionIds: Array.from(selectedTransactions),
        accountBalanceId: selectedAccountBalanceId,
        adjustedStatementBalance,
        endingDate,
      });
      
      setStep('complete');
    } catch (error) {
      // Error handling is done in the mutation hook
    }
  };

  const handleClose = () => {
    setStep('setup');
    setSelectedAccountBalanceId("");
    setEndingDate(undefined);
    setEndingBalance("");
    setInterestEarned("0.00");
    setServiceCharges("0.00");
    setSelectedTransactions(new Set());
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      // Only reset state when dialog is closing (open === false)
      if (!open) {
        handleClose();
      }
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Bank Reconciliation</DialogTitle>
        </DialogHeader>

        {step === 'setup' && (
          <div className="space-y-6 overflow-y-auto px-1">
            <Card>
              <CardHeader>
                <CardTitle>Select Account & Enter Statement Details</CardTitle>
                <CardDescription>
                  Choose the account you want to reconcile and enter the details from your bank statement
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="account">Bank Account</Label>
                  <Select value={selectedAccountBalanceId} onValueChange={setSelectedAccountBalanceId}>
                    <SelectTrigger id="account">
                      <SelectValue placeholder="Select account to reconcile" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccountBalances.map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.institutionName}
                          {account.accountName && ` - ${account.accountName}`}
                          {account.accountMask && ` (••••${account.accountMask})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ending-date">Statement Ending Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          id="ending-date"
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !endingDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {endingDate ? format(endingDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={endingDate}
                          onSelect={setEndingDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ending-balance">Statement Ending Balance</Label>
                    <Input
                      id="ending-balance"
                      type="number"
                      step="0.01"
                      value={endingBalance}
                      onChange={(e) => setEndingBalance(e.target.value)}
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="interest">Interest Earned (optional)</Label>
                    <Input
                      id="interest"
                      type="number"
                      step="0.01"
                      value={interestEarned}
                      onChange={(e) => setInterestEarned(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="charges">Service Charges (optional)</Label>
                    <Input
                      id="charges"
                      type="number"
                      step="0.01"
                      value={serviceCharges}
                      onChange={(e) => setServiceCharges(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleStartReconciliation}
                    disabled={!selectedAccountBalanceId || !endingDate || !endingBalance}
                  >
                    Start Reconciling
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'matching' && (
          <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Reconciliation Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground mb-1">Statement Balance</div>
                    <div className="font-semibold text-lg">
                      ${parseFloat(endingBalance || "0").toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">EasyShift Balance</div>
                    <div className="font-semibold text-lg">
                      ${calculatedBalance.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Opening: ${openingBalance.toFixed(2)} + Selected: ${selectedBalance.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Difference</div>
                    <div className={cn(
                      "font-bold text-lg",
                      Math.abs(difference) < 0.01 ? "text-green-600" : "text-red-600"
                    )}>
                      ${difference.toFixed(2)}
                      {Math.abs(difference) < 0.01 && (
                        <CheckCircle2 className="inline ml-2 h-5 w-5" />
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="flex-1 overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Match Transactions ({selectedTransactions.size} of {eligibleTransactions.length} selected)
                </CardTitle>
                <CardDescription>
                  Check the box next to each transaction that appears on your statement
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full px-6 pb-6">
                  {eligibleTransactions.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground space-y-4">
                      <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <div>
                        <p className="font-medium text-lg mb-2">No transactions available to reconcile</p>
                        <div className="text-sm space-y-2 max-w-md mx-auto text-left">
                          <p className="font-medium">To appear here, transactions must meet ALL criteria:</p>
                          <ul className="list-disc list-inside space-y-1">
                            <li>From the selected bank account ({selectedAccount?.institutionName}
                              {selectedAccount?.accountName && ` - ${selectedAccount.accountName}`})</li>
                            <li>Already categorized (go to "For Review" tab to categorize)</li>
                            <li>Date on or before {endingDate ? format(endingDate, 'MMM dd, yyyy') : 'ending date'}</li>
                            <li>Not already reconciled</li>
                          </ul>
                          <p className="mt-3 text-xs italic">
                            Tip: If you don't see your transactions, first categorize them in the "For Review" tab, 
                            then return here to reconcile.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {eligibleTransactions.map(txn => (
                        <div
                          key={txn.id}
                          className={cn(
                            "flex items-center space-x-3 p-3 rounded-lg border transition-colors",
                            selectedTransactions.has(txn.id) 
                              ? "bg-primary/5 border-primary" 
                              : "hover:bg-muted/50"
                          )}
                        >
                          <Checkbox
                            checked={selectedTransactions.has(txn.id)}
                            onCheckedChange={() => handleToggleTransaction(txn.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{txn.description}</div>
                                <div className="text-sm text-muted-foreground">
                                  {format(new Date(txn.transaction_date), 'MMM dd, yyyy')}
                                  {txn.merchant_name && ` • ${txn.merchant_name}`}
                                </div>
                              </div>
                              <div className={cn(
                                "font-semibold whitespace-nowrap",
                                Number(txn.amount) < 0 ? "text-red-600" : "text-green-600"
                              )}>
                                {Number(txn.amount) < 0 ? '-' : '+'}
                                ${Math.abs(Number(txn.amount)).toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('setup')}>
                Back
              </Button>
              <Button 
                onClick={handleFinish}
                disabled={Math.abs(difference) > 0.01 || reconcileTransactionsMutation.isPending || selectedTransactions.size === 0}
              >
                {reconcileTransactionsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Finishing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Finish Reconciliation
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="space-y-6 py-8">
            <div className="text-center">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-2xl font-bold mb-2">Reconciliation Complete!</h3>
              <p className="text-muted-foreground">
                Successfully reconciled {selectedTransactions.size} transactions for {selectedAccount?.institutionName}
                {selectedAccount?.accountName && ` - ${selectedAccount.accountName}`}
              </p>
            </div>

            <Card>
              <CardContent className="pt-6">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ending Date:</span>
                    <span className="font-medium">{endingDate && format(endingDate, 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ending Balance:</span>
                    <span className="font-medium">${parseFloat(endingBalance).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transactions Reconciled:</span>
                    <span className="font-medium">{selectedTransactions.size}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base">
                    <span className="font-medium">Final Difference:</span>
                    <span className="font-bold text-green-600">$0.00</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                <FileText className="mr-2 h-4 w-4" />
                View Report
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}