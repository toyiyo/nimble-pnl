import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useBankStatementImport } from '@/hooks/useBankStatementImport';
import { useToast } from '@/hooks/use-toast';
import {
  suggestBankColumnMappings,
  detectAccountInfoFromCSV,
  extractUniqueAccounts,
  matchAccountToBank,
  detectTransferPairs,
  type BankColumnMapping,
  type DetectedAccountInfo,
  type AccountBankMatch,
  type TransferPairCandidate,
} from '@/utils/bankTransactionColumnMapping';
import { BankTransactionColumnMappingDialog } from '@/components/BankTransactionColumnMappingDialog';
import {
  BankAccountAssignmentStep,
  type AccountAssignment,
} from '@/components/BankAccountAssignmentStep';

type UploadStep = 'parsing' | 'mapping' | 'account-assignment' | 'staging' | 'complete';

interface ConnectedBank {
  id: string;
  institution_name: string;
  status: string;
}

interface ConnectedBankWithBalances extends ConnectedBank {
  bank_account_balances?: Array<{
    account_mask?: string | null;
    account_type?: string | null;
  }>;
}

interface BankCSVUploadProps {
  file: File;
  onStatementStaged: (statementId: string) => void;
  onCancel: () => void;
}

export const BankCSVUpload: React.FC<BankCSVUploadProps> = ({
  file,
  onStatementStaged,
  onCancel,
}) => {
  const [step, setStep] = useState<UploadStep>('parsing');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [sampleData, setSampleData] = useState<Record<string, string>[]>([]);
  const [suggestedMappings, setSuggestedMappings] = useState<BankColumnMapping[]>([]);
  const [detectedAccountInfo, setDetectedAccountInfo] = useState<DetectedAccountInfo | undefined>();
  const [connectedBanks, setConnectedBanks] = useState<ConnectedBank[]>([]);
  const [connectedBanksWithBalances, setConnectedBanksWithBalances] = useState<ConnectedBankWithBalances[]>([]);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [stagingMessage, setStagingMessage] = useState('');

  // Multi-account state
  const [confirmedMappings, setConfirmedMappings] = useState<BankColumnMapping[]>([]);
  const [accountMatches, setAccountMatches] = useState<AccountBankMatch[]>([]);
  const [transferPairs, setTransferPairs] = useState<TransferPairCandidate[]>([]);
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);

  const { selectedRestaurant } = useRestaurantContext();
  const { stageCSVStatement, detectDuplicates, detectTransfersPostImport } = useBankStatementImport();
  const { toast } = useToast();

  // Parse file on mount
  useEffect(() => {
    parseFile();
    loadConnectedBanks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConnectedBanks = async () => {
    if (!selectedRestaurant?.restaurant_id) return;

    // Fetch banks with balance info for matching
    const { data } = await supabase
      .from('connected_banks')
      .select('id, institution_name, status, bank_account_balances(account_mask, account_type)')
      .eq('restaurant_id', selectedRestaurant.restaurant_id)
      .eq('status', 'connected');

    const banks = (data ?? []) as any as ConnectedBankWithBalances[];
    setConnectedBanksWithBalances(banks);
    setConnectedBanks(banks.map((b) => ({ id: b.id, institution_name: b.institution_name, status: b.status })));
  };

  const parseFile = async () => {
    try {
      const isExcel = /\.xlsx?$/i.test(file.name);
      await (isExcel ? parseExcel() : parseCSV());
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        title: 'Error',
        description: 'Failed to parse file. Please check the file format.',
        variant: 'destructive',
      });
      onCancel();
    }
  };

  const parseCSV = async () => {
    // Read raw lines for account detection
    const rawText = await file.text();
    const rawLines = rawText.split('\n').slice(0, 10);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string, index: number) => header.trim() || `Column_${index}`,
      complete: (results) => {
        const data = results.data as Record<string, string>[];
        const headers = results.meta.fields || [];

        if (data.length === 0 || headers.length === 0) {
          toast({
            title: 'Error',
            description: 'No data found in CSV file',
            variant: 'destructive',
          });
          onCancel();
          return;
        }

        finishParsing(headers, data, rawLines);
      },
      error: (error) => {
        console.error('CSV parse error:', error);
        toast({
          title: 'Error',
          description: 'Failed to parse CSV file',
          variant: 'destructive',
        });
        onCancel();
      },
    });
  };

  const parseExcel = async () => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Get raw rows for account detection
    const rawData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    const rawLines = rawData.slice(0, 10).map((row) => row.join(','));

    // Get data with headers
    const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

    if (jsonData.length === 0) {
      toast({
        title: 'Error',
        description: 'No data found in Excel file',
        variant: 'destructive',
      });
      onCancel();
      return;
    }

    const headers = Object.keys(jsonData[0]);
    finishParsing(headers, jsonData, rawLines);
  };

  const finishParsing = (
    headers: string[],
    data: Record<string, string>[],
    rawLines: string[]
  ) => {
    setCsvHeaders(headers);
    setParsedRows(data);
    setSampleData(data.slice(0, 5));

    // Auto-detect mappings
    const mappings = suggestBankColumnMappings(headers, data.slice(0, 5));
    setSuggestedMappings(mappings);

    // Detect account info
    const accountInfo = detectAccountInfoFromCSV(rawLines, file.name);
    setDetectedAccountInfo(accountInfo);

    setStep('mapping');
    setShowMappingDialog(true);
  };

  const handleMappingConfirm = async (
    mappings: BankColumnMapping[],
    bankId: string,
    bankAccountName?: string,
    hasSourceAccount?: boolean
  ) => {
    setShowMappingDialog(false);

    if (hasSourceAccount) {
      // Multi-account flow: extract accounts and show assignment step
      setConfirmedMappings(mappings);

      const sourceAccountCol = mappings.find((m) => m.targetField === 'sourceAccount')?.csvColumn;
      if (!sourceAccountCol) {
        toast({ title: 'Error', description: 'Source account column not found', variant: 'destructive' });
        onCancel();
        return;
      }

      const accounts = extractUniqueAccounts(parsedRows, sourceAccountCol);
      const matches = accounts.map((acct) => matchAccountToBank(acct, connectedBanksWithBalances));
      setAccountMatches(matches);

      // Detect transfer pairs
      const dateCol = mappings.find((m) => m.targetField === 'transactionDate')?.csvColumn
        || mappings.find((m) => m.targetField === 'postedDate')?.csvColumn
        || '';
      const amountCol = mappings.find((m) => m.targetField === 'amount')?.csvColumn;
      const debitCol = mappings.find((m) => m.targetField === 'debitAmount')?.csvColumn;
      const creditCol = mappings.find((m) => m.targetField === 'creditAmount')?.csvColumn;

      const pairs = detectTransferPairs(
        parsedRows,
        sourceAccountCol,
        dateCol,
        amountCol,
        debitCol,
        creditCol
      );
      setTransferPairs(pairs);

      setStep('account-assignment');
      setShowAssignmentDialog(true);
      return;
    }

    // Single-account flow (existing behavior)
    setStep('staging');

    let resolvedBankId = bankId;

    // Create new bank if needed
    if (bankId === '__new__' && bankAccountName) {
      if (!selectedRestaurant?.restaurant_id) {
        toast({ title: 'Error', description: 'No restaurant selected', variant: 'destructive' });
        onCancel();
        return;
      }
      setStagingMessage('Creating bank account...');
      const { data: newBank, error } = await supabase
        .from('connected_banks')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          stripe_financial_account_id: `csv_import_${crypto.randomUUID()}`,
          institution_name: bankAccountName,
          status: 'connected',
          connected_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error || !newBank) {
        toast({
          title: 'Error',
          description: 'Failed to create bank account',
          variant: 'destructive',
        });
        onCancel();
        return;
      }
      resolvedBankId = newBank.id;
    }

    // Stage the transactions
    setStagingMessage(`Staging ${parsedRows.length} transactions...`);
    const uploadId = await stageCSVStatement(
      file,
      parsedRows,
      mappings,
      resolvedBankId,
      bankAccountName
    );

    if (!uploadId) {
      onCancel();
      return;
    }

    // Detect duplicates
    setStagingMessage('Checking for duplicates...');
    try {
      const duplicateCount = await detectDuplicates(uploadId);

      if (duplicateCount > 0) {
        toast({
          title: 'Duplicates Found',
          description: `${duplicateCount} potential duplicate${duplicateCount === 1 ? '' : 's'} detected and auto-excluded. You can review them before importing.`,
        });
      }
    } catch {
      toast({
        title: 'Warning',
        description: 'Could not check for duplicates. Please review transactions carefully.',
        variant: 'destructive',
      });
    }

    setStep('complete');
    onStatementStaged(uploadId);
  };

  const handleAccountAssignmentConfirm = async (assignments: AccountAssignment[]) => {
    setShowAssignmentDialog(false);
    setStep('staging');

    if (!selectedRestaurant?.restaurant_id) {
      toast({ title: 'Error', description: 'No restaurant selected', variant: 'destructive' });
      onCancel();
      return;
    }

    const uploadIds: string[] = [];

    try {
      // Process each account assignment
      for (let i = 0; i < assignments.length; i++) {
        const assignment = assignments[i];
        const { accountInfo } = assignment;
        let bankId = assignment.bankId;

        // Create new bank if needed
        if (bankId === '__new__' && assignment.newBankName) {
          setStagingMessage(`Creating bank "${assignment.newBankName}"...`);
          const { data: newBank, error } = await supabase
            .from('connected_banks')
            .insert({
              restaurant_id: selectedRestaurant.restaurant_id,
              stripe_financial_account_id: `csv_import_${crypto.randomUUID()}`,
              institution_name: assignment.newBankName,
              status: 'connected',
              connected_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (error || !newBank) {
            toast({
              title: 'Error',
              description: `Failed to create bank "${assignment.newBankName}"`,
              variant: 'destructive',
            });
            continue;
          }
          bankId = newBank.id;

          // Create balance row with mask/type if available
          const balanceInsert: Record<string, unknown> = {
            connected_bank_id: bankId,
            account_name: assignment.newBankName,
            current_balance: 0,
            currency: 'USD',
            as_of_date: new Date().toISOString(),
            is_active: true,
          };
          if (accountInfo.accountMask) balanceInsert.account_mask = accountInfo.accountMask;
          if (accountInfo.accountType) balanceInsert.account_type = accountInfo.accountType;
          await supabase.from('bank_account_balances').insert(balanceInsert as any);
        }

        // Filter rows for this account
        const accountRows = accountInfo.rowIndices.map((idx) => parsedRows[idx]);

        setStagingMessage(
          `Staging account ${i + 1}/${assignments.length}: ${accountInfo.rawValue} (${accountRows.length} transactions)...`
        );

        const uploadId = await stageCSVStatement(
          file,
          accountRows,
          confirmedMappings,
          bankId,
          assignment.newBankName || accountInfo.rawValue,
          accountInfo.rawValue
        );

        if (uploadId) {
          uploadIds.push(uploadId);

          // Detect duplicates per upload
          setStagingMessage(`Checking duplicates for ${accountInfo.rawValue}...`);
          try {
            const dups = await detectDuplicates(uploadId);
            if (dups > 0) {
              toast({
                title: 'Duplicates Found',
                description: `${dups} duplicate${dups !== 1 ? 's' : ''} in "${accountInfo.rawValue}" auto-excluded.`,
              });
            }
          } catch {
            // Non-fatal
          }
        }
      }

      if (uploadIds.length === 0) {
        toast({
          title: 'Error',
          description: 'No accounts were staged successfully',
          variant: 'destructive',
        });
        onCancel();
        return;
      }

      // Detect inter-account transfers
      if (uploadIds.length > 1) {
        setStagingMessage('Detecting inter-account transfers...');
        const transferCount = await detectTransfersPostImport(uploadIds);
        if (transferCount > 0) {
          toast({
            title: 'Transfers Detected',
            description: `${transferCount} inter-account transfer${transferCount !== 1 ? 's' : ''} flagged.`,
          });
        }
      }

      setStep('complete');
      // Navigate to the first upload for review
      onStatementStaged(uploadIds[0]);
    } catch (error) {
      console.error('Error during multi-account staging:', error);
      toast({
        title: 'Error',
        description: 'Failed to process multi-account import',
        variant: 'destructive',
      });
      onCancel();
    }
  };

  const handleMappingCancel = () => {
    setShowMappingDialog(false);
    onCancel();
  };

  const handleAssignmentCancel = () => {
    setShowAssignmentDialog(false);
    onCancel();
  };

  // Parsing/staging loading states share identical layout
  if (step === 'parsing' || step === 'staging') {
    const message = step === 'parsing'
      ? `Parsing ${file.name}...`
      : stagingMessage || 'Processing...';

    return (
      <div className="flex items-center justify-center p-12" aria-live="polite">
        <output className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[14px]">{message}</span>
        </output>
      </div>
    );
  }

  // Account assignment dialog
  if (step === 'account-assignment') {
    return (
      <BankAccountAssignmentStep
        open={showAssignmentDialog}
        onOpenChange={(open) => {
          if (!open) handleAssignmentCancel();
        }}
        accounts={accountMatches}
        transferPairs={transferPairs}
        connectedBanks={connectedBanks}
        onConfirm={handleAccountAssignmentConfirm}
      />
    );
  }

  // Mapping dialog
  return (
    <BankTransactionColumnMappingDialog
      open={showMappingDialog}
      onOpenChange={(open) => {
        if (!open) handleMappingCancel();
      }}
      csvHeaders={csvHeaders}
      sampleData={sampleData}
      suggestedMappings={suggestedMappings}
      connectedBanks={connectedBanks}
      detectedAccountInfo={detectedAccountInfo}
      onConfirm={handleMappingConfirm}
    />
  );
};
