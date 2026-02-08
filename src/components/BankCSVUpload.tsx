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
  type BankColumnMapping,
  type DetectedAccountInfo,
} from '@/utils/bankTransactionColumnMapping';
import { BankTransactionColumnMappingDialog } from '@/components/BankTransactionColumnMappingDialog';

type UploadStep = 'parsing' | 'mapping' | 'staging' | 'complete';

interface ConnectedBank {
  id: string;
  institution_name: string;
  status: string;
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
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [stagingMessage, setStagingMessage] = useState('');

  const { selectedRestaurant } = useRestaurantContext();
  const { stageCSVStatement, detectDuplicates } = useBankStatementImport();
  const { toast } = useToast();

  // Parse file on mount
  useEffect(() => {
    parseFile();
    loadConnectedBanks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConnectedBanks = async () => {
    if (!selectedRestaurant?.restaurant_id) return;

    const { data } = await supabase
      .from('connected_banks')
      .select('id, institution_name, status')
      .eq('restaurant_id', selectedRestaurant.restaurant_id)
      .eq('status', 'connected');

    setConnectedBanks(data ?? []);
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
    bankAccountName?: string
  ) => {
    setShowMappingDialog(false);
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

  const handleMappingCancel = () => {
    setShowMappingDialog(false);
    onCancel();
  };

  // Parsing/staging loading states share identical layout
  if (step === 'parsing' || step === 'staging') {
    const message = step === 'parsing'
      ? `Parsing ${file.name}...`
      : stagingMessage || 'Processing...';

    return (
      <div className="flex items-center justify-center p-12" aria-live="polite">
        <div className="flex items-center gap-3 text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[14px]">{message}</span>
        </div>
      </div>
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
