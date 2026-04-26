import { useState, useCallback, useEffect } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  Printer,
  Settings,
  Plus,
  Trash2,
  History,
  FileText,
  RotateCcw,
} from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCheckSettings } from '@/hooks/useCheckSettings';
import { useCheckBankAccounts } from '@/hooks/useCheckBankAccounts';
import { useCheckAuditLog } from '@/hooks/useCheckAuditLog';
import type { CheckAuditEntry } from '@/hooks/useCheckAuditLog';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import { useSuppliers } from '@/hooks/useSuppliers';
import { FeatureGate } from '@/components/subscription';

import { CheckSettingsDialog } from '@/components/checks/CheckSettingsDialog';
import {
  generateCheckPDF,
  generateCheckPDFAsync,
  generateCheckFilename,
  buildPrintConfig,
  numberToWords,
} from '@/utils/checkPrinting';
import type { CheckData } from '@/utils/checkPrinting';
import { formatCurrency } from '@/utils/pdfExport';
import { format } from 'date-fns';
import { toast } from 'sonner';

const ACTION_BADGE_CLASSES: Record<string, string> = {
  printed: 'text-green-700 border-green-300',
  voided: 'text-red-700 border-red-300',
  reprinted: 'text-blue-700 border-blue-300',
};

interface CheckRow {
  id: string;
  payeeName: string;
  amount: string;
  issueDate: string;
  memo: string;
  selected: boolean;
}

function createEmptyRow(): CheckRow {
  return {
    id: crypto.randomUUID(),
    payeeName: '',
    amount: '',
    issueDate: format(new Date(), 'yyyy-MM-dd'),
    memo: '',
    selected: true,
  };
}


export default function PrintChecks() {
  return (
    <FeatureGate featureKey="expenses">
      <PrintChecksContent />
    </FeatureGate>
  );
}

function PrintChecksContent() {
  const { selectedRestaurant } = useRestaurantContext();
  const { settings, isLoading: settingsLoading } = useCheckSettings();
  const { accounts, defaultAccount, isLoading: accountsLoading, claimCheckNumbers, fetchAccountSecrets } = useCheckBankAccounts();
  const { auditLog, isLoading: auditLoading, logCheckAction } = useCheckAuditLog();
  const { createPendingOutflow } = usePendingOutflowMutations();
  const { suppliers } = useSuppliers();

  const [showSettings, setShowSettings] = useState(false);
  const [rows, setRows] = useState<CheckRow[]>([createEmptyRow()]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'write' | 'history'>('write');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Auto-select default account when accounts load
  useEffect(() => {
    if (defaultAccount && !selectedAccountId) {
      setSelectedAccountId(defaultAccount.id);
    }
  }, [defaultAccount, selectedAccountId]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? defaultAccount;

  // --- Row helpers ---
  const updateRow = useCallback((id: string, field: keyof CheckRow, value: string | boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length === 0 ? [createEmptyRow()] : next;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, createEmptyRow()]);
  }, []);

  const selectedRows = rows.filter((r) => r.selected);
  const totalAmount = selectedRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

  // --- Print ---
  const handlePrint = async () => {
    if (!settings || !selectedRestaurant) return;
    if (!selectedAccount) {
      toast.error('Please select a bank account');
      return;
    }

    // Validate
    for (const row of selectedRows) {
      if (!row.payeeName.trim()) {
        toast.error('All selected checks must have a payee name');
        return;
      }
      const amt = parseFloat(row.amount);
      if (!amt || amt <= 0) {
        toast.error(`Check for "${row.payeeName}" must have a valid amount`);
        return;
      }
    }

    setIsPrinting(true);

    try {
      // Fetch MICR secrets first so any failure aborts BEFORE we claim check
      // numbers or write "printed" audit rows that wouldn't match a real PDF.
      let secrets: { routing_number: string; account_number: string } | null = null;
      if (selectedAccount.print_bank_info) {
        if (!selectedAccount.routing_number || !selectedAccount.account_number_last4) {
          toast.error('Bank info incomplete. Open Check Settings to add the routing and account numbers, or turn off "Print bank info" for this account.');
          return;
        }
        try {
          secrets = await fetchAccountSecrets(selectedAccount.id);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't load bank info");
          return;
        }
        if (!secrets) {
          toast.error('Account number is missing. Re-enter it in Check Settings.');
          return;
        }
      }

      const startNumber = await claimCheckNumbers.mutateAsync({
        accountId: selectedAccount.id,
        count: selectedRows.length,
      });

      const checks: CheckData[] = selectedRows.map((row, i) => ({
        checkNumber: startNumber + i,
        payeeName: row.payeeName.trim(),
        amount: parseFloat(row.amount),
        issueDate: row.issueDate,
        memo: row.memo.trim() || undefined,
      }));

      for (const check of checks) {
        const outflow = await createPendingOutflow.mutateAsync({
          vendor_name: check.payeeName,
          amount: check.amount,
          payment_method: 'check',
          reference_number: String(check.checkNumber),
          issue_date: check.issueDate,
          notes: check.memo ?? null,
        });

        await logCheckAction.mutateAsync({
          check_number: check.checkNumber,
          payee_name: check.payeeName,
          amount: check.amount,
          issue_date: check.issueDate,
          memo: check.memo ?? null,
          action: 'printed',
          pending_outflow_id: outflow.id,
          check_bank_account_id: selectedAccount.id,
        });
      }

      const config = buildPrintConfig(settings, selectedAccount, secrets);
      const pdf = selectedAccount.print_bank_info
        ? await generateCheckPDFAsync(config, checks)
        : generateCheckPDF(config, checks);
      const filename = generateCheckFilename(
        selectedRestaurant.restaurant.name,
        checks.map((c) => c.checkNumber),
      );
      pdf.save(filename);

      toast.success(`${checks.length} check${checks.length > 1 ? 's' : ''} printed`);

      // Reset form
      setRows([createEmptyRow()]);
    } catch (err) {
      console.error('Print checks error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to print checks');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleReprint = async (entry: Pick<CheckAuditEntry, 'id' | 'check_number' | 'payee_name' | 'amount' | 'issue_date' | 'memo' | 'check_bank_account_id'>) => {
    if (!settings || !selectedRestaurant) return;

    setReprintingId(entry.id);
    try {
      const reprintAccount = entry.check_bank_account_id
        ? accounts.find((a) => a.id === entry.check_bank_account_id)
        : selectedAccount;

      // Fetch MICR secrets first so a failure aborts BEFORE we write the
      // "reprinted" audit row.
      let secrets: { routing_number: string; account_number: string } | null = null;
      if (reprintAccount?.print_bank_info) {
        if (!reprintAccount.routing_number || !reprintAccount.account_number_last4) {
          toast.error('Bank info incomplete for this account. Open Check Settings to add it, or turn off "Print bank info".');
          return;
        }
        try {
          secrets = await fetchAccountSecrets(reprintAccount.id);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't load bank info");
          return;
        }
        if (!secrets) {
          toast.error('Account number is missing. Re-enter it in Check Settings.');
          return;
        }
      }

      await logCheckAction.mutateAsync({
        check_number: entry.check_number,
        payee_name: entry.payee_name,
        amount: entry.amount,
        issue_date: entry.issue_date,
        memo: entry.memo,
        action: 'reprinted',
        check_bank_account_id: entry.check_bank_account_id ?? selectedAccount?.id ?? null,
      });

      const reprintChecks = [{
        checkNumber: entry.check_number,
        payeeName: entry.payee_name,
        amount: entry.amount,
        issueDate: entry.issue_date,
        memo: entry.memo ?? undefined,
      }];
      const reprintConfig = buildPrintConfig(settings, reprintAccount ?? null, secrets);
      const pdf = reprintAccount?.print_bank_info
        ? await generateCheckPDFAsync(reprintConfig, reprintChecks)
        : generateCheckPDF(reprintConfig, reprintChecks);
      const filename = generateCheckFilename(
        selectedRestaurant.restaurant.name,
        [entry.check_number],
      );
      pdf.save(filename);

      toast.success(`Check #${entry.check_number} reprinted`);
    } catch (err) {
      console.error('Reprint check error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to reprint check');
    } finally {
      setReprintingId(null);
    }
  };

  // --- Loading / no-settings states ---
  if (!selectedRestaurant) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader icon={Printer} title="Print Checks" />
        <div className="w-full px-4 py-8">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Please select a restaurant first.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (settingsLoading || accountsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader icon={Printer} title="Print Checks" />
        <div className="w-full px-4 py-8 space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader icon={Printer} title="Print Checks" />
        <div className="w-full px-4 py-8">
          <Card className="max-w-2xl mx-auto">
            <CardContent className="py-12 text-center">
              <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-[17px] font-semibold text-foreground mb-2">
                Configure Check Settings
              </h3>
              <p className="text-[14px] text-muted-foreground mb-6 max-w-md mx-auto">
                Set up your business name, address, and starting check number before printing checks.
              </p>
              <Button
                onClick={() => setShowSettings(true)}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                <Settings className="h-4 w-4 mr-2" />
                Configure Settings
              </Button>
            </CardContent>
          </Card>
        </div>
        <CheckSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      </div>
    );
  }

  // --- Main render ---
  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        icon={Printer}
        title="Print Checks"
        subtitle={`${settings.business_name}${selectedAccount ? ` · Next check #${selectedAccount.next_check_number}` : ''}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(true)}
            aria-label="Edit check settings"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        }
      />

      <div className="w-full px-4 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex border-b border-border/40">
          <button
            onClick={() => setActiveTab('write')}
            className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
              activeTab === 'write' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Write Checks
            {activeTab === 'write' && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
              activeTab === 'history' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            History
            {activeTab === 'history' && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
        </div>

        {activeTab === 'write' && (
          <>
            {/* Bank account selector — only shown when multiple accounts exist */}
            {accounts.length > 1 && (
              <div className="flex items-center gap-3">
                <Label htmlFor="check-bank-account" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Bank Account
                </Label>
                <Select value={selectedAccountId ?? ''} onValueChange={setSelectedAccountId}>
                  <SelectTrigger id="check-bank-account" className="h-9 w-64 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.account_name}{account.bank_name ? ` (${account.bank_name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* No accounts prompt */}
            {accounts.length === 0 && (
              <div className="rounded-xl border border-border/40 bg-muted/30 p-6 text-center">
                <p className="text-[14px] text-muted-foreground mb-3">
                  No bank accounts configured. Add a bank account in Settings to start printing checks.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSettings(true)}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Open Settings
                </Button>
              </div>
            )}

            {/* Check entry table */}
            <Card className="border-border/40">
              <CardHeader className="border-b border-border/40 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-[17px] font-semibold">Checks to Print</CardTitle>
                    <CardDescription className="text-[13px] mt-1">
                      Add vendor payments, then click Print to generate a PDF
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedRows.length > 0 && (
                      <Badge className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
                        {selectedRows.length} selected · {formatCurrency(totalAmount)}
                      </Badge>
                    )}
                    <Button variant="outline" size="sm" onClick={addRow} aria-label="Add another check">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Row
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/40">
                        <TableHead className="w-10 pl-4" />
                        <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Check #
                        </TableHead>
                        <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Pay To
                        </TableHead>
                        <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Amount
                        </TableHead>
                        <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Date
                        </TableHead>
                        <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Memo
                        </TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, rowIndex) => {
                        const selectedBefore = rows
                          .slice(0, rowIndex)
                          .filter((r) => r.selected).length;
                        const checkNum = row.selected
                          ? (selectedAccount?.next_check_number ?? 1001) + selectedBefore
                          : null;
                        const amt = parseFloat(row.amount) || 0;

                        return (
                          <TableRow key={row.id} className="border-border/40">
                            <TableCell className="pl-4">
                              <Checkbox
                                checked={row.selected}
                                onCheckedChange={(v) => updateRow(row.id, 'selected', !!v)}
                                aria-label={`Select check for ${row.payeeName || 'new payee'}`}
                              />
                            </TableCell>
                            <TableCell>
                              <span className="text-[14px] font-medium text-foreground tabular-nums">
                                {checkNum ?? '—'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.payeeName}
                                onChange={(e) => updateRow(row.id, 'payeeName', e.target.value)}
                                placeholder="Vendor name"
                                list="supplier-list"
                                className="h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={row.amount}
                                  onChange={(e) => updateRow(row.id, 'amount', e.target.value)}
                                  placeholder="0.00"
                                  className="h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border w-28"
                                />
                                {amt > 0 && (
                                  <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                                    {numberToWords(amt)}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="date"
                                value={row.issueDate}
                                onChange={(e) => updateRow(row.id, 'issueDate', e.target.value)}
                                className="h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border w-36"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.memo}
                                onChange={(e) => updateRow(row.id, 'memo', e.target.value)}
                                placeholder="Optional"
                                className="h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeRow(row.id)}
                                aria-label={`Remove check for ${row.payeeName || 'new payee'}`}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Supplier datalist for autocomplete */}
            {suppliers && suppliers.length > 0 && (
              <datalist id="supplier-list">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            )}

            {/* Print action bar */}
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-muted-foreground">
                {selectedRows.length > 0
                  ? `${selectedRows.length} check${selectedRows.length > 1 ? 's' : ''} · ${formatCurrency(totalAmount)} total`
                  : 'No checks selected'}
              </p>
              <Button
                onClick={handlePrint}
                disabled={selectedRows.length === 0 || isPrinting}
                className="h-10 px-6 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                <Printer className="h-4 w-4 mr-2" />
                {isPrinting
                  ? 'Printing...'
                  : `Print ${selectedRows.length} Check${selectedRows.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </>
        )}

        {activeTab === 'history' && (
          <Card className="border-border/40">
            <CardHeader className="border-b border-border/40 pb-4">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-[17px] font-semibold">Check History</CardTitle>
                  <CardDescription className="text-[13px] mt-1">
                    Audit log of all printed, voided, and reprinted checks
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {auditLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : auditLog.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-[14px] text-muted-foreground">No checks printed yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/40">
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Check #
                      </TableHead>
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Payee
                      </TableHead>
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                        Amount
                      </TableHead>
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Date
                      </TableHead>
                      {accounts.length > 1 && (
                        <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Account
                        </TableHead>
                      )}
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Action
                      </TableHead>
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Printed
                      </TableHead>
                      <TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLog.map((entry) => {
                      const entryAccount = entry.check_bank_account_id
                        ? accounts.find((a) => a.id === entry.check_bank_account_id)
                        : null;
                      return (
                        <TableRow key={entry.id} className="border-border/40">
                          <TableCell className="text-[14px] font-medium tabular-nums">
                            {entry.check_number}
                          </TableCell>
                          <TableCell className="text-[14px]">{entry.payee_name}</TableCell>
                          <TableCell className="text-[14px] text-right tabular-nums">
                            {formatCurrency(entry.amount)}
                          </TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">
                            {format(new Date(entry.issue_date), 'MMM d, yyyy')}
                          </TableCell>
                          {accounts.length > 1 && (
                            <TableCell className="text-[13px] text-muted-foreground">
                              {entryAccount?.account_name ?? '—'}
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={ACTION_BADGE_CLASSES[entry.action]}
                            >
                              {entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">
                            {format(new Date(entry.performed_at), 'MMM d, yyyy h:mm a')}
                          </TableCell>
                          <TableCell>
                            {(entry.action === 'printed' || entry.action === 'reprinted') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleReprint(entry)}
                                disabled={reprintingId === entry.id}
                                aria-label={`Reprint check ${entry.check_number}`}
                                className="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
                              >
                                <RotateCcw className={`h-3.5 w-3.5 mr-1 ${reprintingId === entry.id ? 'animate-spin' : ''}`} />
                                {reprintingId === entry.id ? 'Printing...' : 'Reprint'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <CheckSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
