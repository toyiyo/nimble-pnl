import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { parseBankAmount, type BankColumnMapping } from '@/utils/bankTransactionColumnMapping';

export interface BankStatementUpload {
  id: string;
  restaurant_id: string;
  bank_name: string | null;
  statement_period_start: string | null;
  statement_period_end: string | null;
  raw_file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  processed_at: string | null;
  status: string;
  raw_ocr_data: Record<string, unknown>;
  transaction_count: number | null;
  total_debits: number | null;
  total_credits: number | null;
  error_message: string | null;
  source_type: string | null;
  connected_bank_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementLine {
  id: string;
  statement_upload_id: string;
  transaction_date: string | null;
  description: string;
  amount: number | null;
  transaction_type: string;
  balance: number | null;
  line_sequence: number;
  confidence_score: number | null;
  is_imported: boolean;
  imported_transaction_id: string | null;
  has_validation_error: boolean;
  validation_errors: Record<string, string> | null;
  user_excluded: boolean;
  is_potential_duplicate: boolean;
  duplicate_transaction_id: string | null;
  duplicate_confidence: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Helper function to determine if a bank statement line is importable.
 * This predicate must match the import logic in importStatementLines.
 * 
 * A line is importable if:
 * 1. It hasn't been imported yet
 * 2. It hasn't been excluded by the user
 * 3. It has no validation errors
 * 4. All required fields are present (transaction_date, description, amount)
 */
export const isLineImportable = (line: BankStatementLine): boolean => {
  return (
    !line.is_imported &&
    !line.user_excluded &&
    !line.has_validation_error &&
    line.transaction_date !== null &&
    line.description !== '' &&
    line.amount !== null
  );
};

export const useBankStatementImport = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();

  const uploadBankStatement = async (file: File) => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return null;
    }

    // Validate file type
    if (file.type !== 'application/pdf') {
      toast({
        title: "Error",
        description: "Only PDF files are supported for bank statements",
        variant: "destructive",
      });
      return null;
    }

    // Validate file size (5MB limit for processing)
    const MAX_FILE_SIZE_MB = 5;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      toast({
        title: "File Too Large",
        description: `Your file is ${fileSizeMB}MB. Maximum size is ${MAX_FILE_SIZE_MB}MB. Please split your statement into smaller PDFs.`,
        variant: "destructive",
      });
      return null;
    }

    setIsUploading(true);
    try {
      // Sanitize filename
      const fileExt = file.name.split('.').pop();
      const sanitizedBaseName = file.name
        .replace(`.${fileExt}`, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const finalFileName = `${Date.now()}-${sanitizedBaseName}.${fileExt}`;
      const filePath = `${selectedRestaurant.restaurant_id}/bank-statements/${finalFileName}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipt-images')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // Create bank statement upload record
      const { data: statementData, error: statementError } = await supabase
        .from('bank_statement_uploads')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          raw_file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          status: 'uploaded'
        })
        .select()
        .single();

      if (statementError) {
        throw statementError;
      }

      toast({
        title: "Success",
        description: "Bank statement uploaded successfully",
      });

      return statementData;
    } catch (error) {
      console.error('Error uploading bank statement:', error);
      toast({
        title: "Error",
        description: "Failed to upload bank statement",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const processBankStatement = async (statementUploadId: string) => {
    setIsProcessing(true);
    try {
      console.log('Processing bank statement...');

      // Get the statement upload record to fetch the storage URL
      const { data: statementData, error: statementError } = await supabase
        .from('bank_statement_uploads')
        .select('raw_file_url')
        .eq('id', statementUploadId)
        .single();

      if (statementError || !statementData?.raw_file_url) {
        throw new Error('Failed to get PDF storage URL');
      }

      // Generate a signed URL for the PDF
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from('receipt-images')
        .createSignedUrl(statementData.raw_file_url, 3600);

      if (signedUrlError || !signedUrlData?.signedUrl) {
        console.error('Failed to create signed URL:', signedUrlError);
        throw new Error('Failed to generate signed URL for PDF');
      }

      console.log('Generated PDF signed URL for processing');

      // Create AbortController for timeout
      const controller = new AbortController();
      let timeoutId: number | undefined;

      try {
        timeoutId = setTimeout(() => {
          controller.abort();
        }, 90000) as unknown as number; // Increased to 90 seconds for larger files

        // Call the edge function
        const { data, error } = await supabase.functions.invoke('process-bank-statement', {
          body: {
            statementUploadId,
            pdfUrl: signedUrlData.signedUrl,
          },
          // @ts-expect-error - signal option is supported but not in types yet
          signal: controller.signal
        });

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        if (error) {
          // Handle specific error cases
          if (error.message?.includes('too large') || error.message?.includes('413')) {
            throw new Error('Bank statement file is too large. Please split it into smaller PDFs (max 5MB).');
          }
          throw error;
        }

        const message = data.invalidTransactionCount > 0
          ? `Bank statement processed! Found ${data.transactionCount} transactions from ${data.bankName}. ${data.invalidTransactionCount} transaction(s) have validation errors that need your attention.`
          : `Bank statement processed! Found ${data.transactionCount} transactions from ${data.bankName}`;

        toast({
          title: "Success",
          description: message,
        });

        return data;
      } catch (error: unknown) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
          throw new Error('Bank statement processing timed out. Your file may be too large - please try splitting it into smaller PDFs.');
        }

        throw error;
      }
    } catch (error) {
      console.error('Error processing bank statement:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process bank statement';
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const getBankStatementUploads = async () => {
    if (!selectedRestaurant?.restaurant_id) return [];

    try {
      const { data, error } = await supabase
        .from('bank_statement_uploads')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []) as BankStatementUpload[];
    } catch (error) {
      console.error('Error fetching bank statement uploads:', error);
      return [];
    }
  };

  const getBankStatementDetails = async (statementUploadId: string) => {
    try {
      const { data, error } = await supabase
        .from('bank_statement_uploads')
        .select('*')
        .eq('id', statementUploadId)
        .single();

      if (error) throw error;

      return data as BankStatementUpload;
    } catch (error) {
      console.error('Error fetching bank statement details:', error);
      return null;
    }
  };

  const getBankStatementLines = async (statementUploadId: string) => {
    const { data, error } = await supabase
      .from('bank_statement_lines')
      .select('*')
      .eq('statement_upload_id', statementUploadId)
      .order('line_sequence', { ascending: true });

    if (error) {
      console.error('Error fetching bank statement lines:', error);
      return [];
    }

    return data as BankStatementLine[];
  };

  const updateStatementLine = async (
    lineId: string,
    updates: {
      transaction_date?: string | null;
      description?: string;
      amount?: number | null;
      transaction_type?: string;
    }
  ) => {
    // Validate the updates to clear validation errors if all required fields are present
    const hasAllRequiredFields = updates.transaction_date && updates.description && updates.amount !== null && updates.amount !== undefined;
    
    const updateData: typeof updates & {
      has_validation_error?: boolean;
      validation_errors?: null;
    } = { ...updates };

    // If all required fields are present and valid, clear validation errors
    if (hasAllRequiredFields) {
      updateData.has_validation_error = false;
      updateData.validation_errors = null;
    }

    const { error } = await supabase
      .from('bank_statement_lines')
      .update(updateData)
      .eq('id', lineId);

    if (error) {
      console.error('Error updating statement line:', error);
      toast({
        title: "Error",
        description: "Failed to update transaction",
        variant: "destructive",
      });
      return false;
    }

    toast({
      title: "Success",
      description: hasAllRequiredFields 
        ? "Transaction updated and validation errors cleared"
        : "Transaction updated",
    });

    return true;
  };

  const toggleLineExclusion = async (lineId: string, excluded: boolean) => {
    const { error } = await supabase
      .from('bank_statement_lines')
      .update({ user_excluded: excluded })
      .eq('id', lineId);

    if (error) {
      console.error('Error toggling line exclusion:', error);
      toast({
        title: "Error",
        description: "Failed to update transaction",
        variant: "destructive",
      });
      return false;
    }

    toast({
      title: excluded ? "Transaction excluded" : "Transaction included",
      description: excluded 
        ? "This transaction will be skipped during import"
        : "This transaction will be included in the import",
    });

    return true;
  };

  const importStatementLines = async (statementUploadId: string) => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return false;
    }

    try {
      // Get statement upload details and all unimported lines
      const [statementResult, linesResult] = await Promise.all([
        supabase
          .from('bank_statement_uploads')
          .select('*')
          .eq('id', statementUploadId)
          .single(),
        supabase
          .from('bank_statement_lines')
          .select('*')
          .eq('statement_upload_id', statementUploadId)
          .eq('is_imported', false)
      ]);

      if (statementResult.error) {
        throw statementResult.error;
      }

      if (linesResult.error) {
        throw linesResult.error;
      }

      const statement = statementResult.data;
      const lines = linesResult.data;

      if (lines.length === 0) {
        toast({
          title: "Info",
          description: "No transactions to import",
        });
        return true;
      }

      // Determine connected_bank_id: use from upload record (CSV import) or create Manual Upload bank
      let connectedBankId: string;
      const isCSVImport = statement.source_type === 'csv' || statement.source_type === 'excel';

      if (isCSVImport && statement.connected_bank_id) {
        connectedBankId = statement.connected_bank_id;
        await ensureBankBalanceExists(connectedBankId, statement.bank_name || 'CSV Import Account');
      } else {
        connectedBankId = await resolveManualUploadBankId(
          selectedRestaurant.restaurant_id,
          statement.bank_name || 'Manual Upload Account'
        );
      }

      let importedCount = 0;
      let skippedCount = 0;

      for (const line of lines) {
        // Use the shared predicate to determine if line can be imported
        // This ensures UI count matches what will actually be imported
        if (!isLineImportable(line)) {
          skippedCount++;
          if (line.has_validation_error) {
            console.log(`Skipping line ${line.id} due to validation errors:`, line.validation_errors);
          } else {
            console.log(`Skipping line ${line.id} - missing required fields or already imported`);
          }
          continue;
        }

        // Create bank transaction
        const txnSource = isCSVImport ? 'csv_import' : 'manual_upload';
        const syntheticId = isCSVImport
          ? `csv_${statementUploadId}_${line.id}`
          : `manual_${statementUploadId}_${line.id}`;

        const { data: newTransaction, error: transactionError } = await supabase
          .from('bank_transactions')
          .insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            connected_bank_id: connectedBankId,
            stripe_transaction_id: syntheticId,
            transaction_date: line.transaction_date,
            posted_date: line.transaction_date,
            description: line.description,
            amount: line.amount,
            source: txnSource,
            statement_upload_id: statementUploadId,
            status: 'posted',
            is_categorized: false,
          })
          .select()
          .single();

        if (transactionError) {
          console.error('Error creating bank transaction:', transactionError);
          continue;
        }

        // Mark line as imported
        await supabase
          .from('bank_statement_lines')
          .update({ 
            is_imported: true,
            imported_transaction_id: newTransaction.id 
          })
          .eq('id', line.id);

        importedCount++;
      }

      // Calculate total balance from all imported transactions for this bank
      const { data: allTransactions } = await supabase
        .from('bank_transactions')
        .select('amount')
        .eq('connected_bank_id', connectedBankId);

      const totalBalance = allTransactions?.reduce((sum, t) => sum + t.amount, 0) || 0;

      // Update the bank account balance
      await supabase
        .from('bank_account_balances')
        .update({
          current_balance: totalBalance,
          as_of_date: new Date().toISOString(),
        })
        .eq('connected_bank_id', connectedBankId);

      // Mark statement as imported
      await supabase
        .from('bank_statement_uploads')
        .update({ status: 'imported' })
        .eq('id', statementUploadId);

      const message = skippedCount > 0 
        ? `Successfully imported ${importedCount} transactions. ${skippedCount} transactions with validation errors were skipped. Balance updated to ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalBalance)}`
        : `Successfully imported ${importedCount} transactions. Balance updated to ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalBalance)}`;

      toast({
        title: "Import Complete",
        description: message,
      });

      return true;
    } catch (error) {
      console.error('Error during import:', error);
      toast({
        title: "Error",
        description: "Failed to import transactions",
        variant: "destructive",
      });
      return false;
    }
  };

  /**
   * Stage a CSV/Excel file as bank statement lines for review.
   */
  const stageCSVStatement = async (
    file: File,
    parsedRows: Record<string, string>[],
    mappings: BankColumnMapping[],
    selectedBankId: string,
    bankAccountName?: string
  ): Promise<string | null> => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return null;
    }

    // Guard against __new__ being passed directly
    if (selectedBankId === '__new__') {
      toast({
        title: "Error",
        description: "Bank account must be created before staging transactions",
        variant: "destructive",
      });
      return null;
    }

    try {
      const isExcel = /\.xlsx?$/i.test(file.name);
      const sourceType = isExcel ? 'excel' : 'csv';

      // Create the upload record
      const { data: uploadData, error: uploadError } = await supabase
        .from('bank_statement_uploads')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          file_name: file.name,
          file_size: file.size,
          status: 'processed',
          source_type: sourceType,
          connected_bank_id: selectedBankId,
          bank_name: bankAccountName || null,
        })
        .select()
        .single();

      if (uploadError || !uploadData) {
        throw new Error('Failed to create upload record');
      }

      const uploadId = uploadData.id;
      const lookups = buildMappingLookups(mappings);

      // Transform rows
      const lines: StatementLineInsert[] = [];
      let totalDebits = 0;
      let totalCredits = 0;

      for (let i = 0; i < parsedRows.length; i++) {
        const { line, amount } = parseCSVRow(parsedRows[i], lookups, uploadId, i);
        lines.push(line);
        if (amount !== null) {
          if (amount < 0) totalDebits += Math.abs(amount);
          else totalCredits += amount;
        }
      }

      // Batch insert in chunks of 100
      await insertLinesInChunks(lines);

      // Update upload with totals
      await supabase
        .from('bank_statement_uploads')
        .update({
          transaction_count: lines.length,
          total_debits: totalDebits,
          total_credits: totalCredits,
          processed_at: new Date().toISOString(),
        })
        .eq('id', uploadId);

      return uploadId;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error staging CSV statement:', error);
      toast({
        title: "Error",
        description: "Failed to stage CSV transactions",
        variant: "destructive",
      });
      return null;
    }
  };

  /**
   * Detect duplicates between staged lines and existing bank transactions.
   */
  const detectDuplicates = async (statementUploadId: string): Promise<number> => {
    if (!selectedRestaurant?.restaurant_id) return 0;

    try {
      // Get staged lines
      const { data: stagedLines, error: linesError } = await supabase
        .from('bank_statement_lines')
        .select('id, transaction_date, description, amount')
        .eq('statement_upload_id', statementUploadId)
        .eq('has_validation_error', false);

      if (linesError || !stagedLines || stagedLines.length === 0) return 0;

      // Get date range
      const dates = stagedLines
        .map((l) => l.transaction_date)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      if (dates.length === 0) return 0;

      const minDate = dates[0];
      const maxDate = dates.at(-1);
      if (!maxDate) return 0;

      // Get existing transactions in the date range
      const { data: existingTxns, error: txnError } = await supabase
        .from('bank_transactions')
        .select('id, transaction_date, description, amount')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .gte('transaction_date', minDate)
        .lte('transaction_date', maxDate);

      if (txnError || !existingTxns || existingTxns.length === 0) return 0;

      let flaggedCount = 0;

      for (const line of stagedLines) {
        const result = findBestDuplicateMatch(line, existingTxns);
        if (!result) continue;

        await supabase
          .from('bank_statement_lines')
          .update({
            is_potential_duplicate: true,
            duplicate_transaction_id: result.match.id,
            duplicate_confidence: result.confidence,
            user_excluded: result.confidence >= 0.9,
          })
          .eq('id', line.id);

        flaggedCount++;
      }

      return flaggedCount;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error detecting duplicates:', error);
      return 0;
    }
  };

  const recalculateBankBalance = async (connectedBankId: string) => {
    try {
      const { data: allTransactions, error: transError } = await supabase
        .from('bank_transactions')
        .select('amount')
        .eq('connected_bank_id', connectedBankId);

      if (transError) throw transError;

      const totalBalance = allTransactions?.reduce((sum, t) => sum + t.amount, 0) || 0;

      // Ensure balance row exists, then update with calculated total
      await ensureBankBalanceExists(connectedBankId, 'Manual Upload Account');
      await supabase
        .from('bank_account_balances')
        .update({
          current_balance: totalBalance,
          as_of_date: new Date().toISOString(),
        })
        .eq('connected_bank_id', connectedBankId);

      return totalBalance;
    } catch (error) {
      console.error('Error recalculating bank balance:', error);
      throw error;
    }
  };

  return {
    uploadBankStatement,
    processBankStatement,
    getBankStatementUploads,
    getBankStatementDetails,
    getBankStatementLines,
    updateStatementLine,
    toggleLineExclusion,
    importStatementLines,
    stageCSVStatement,
    detectDuplicates,
    recalculateBankBalance,
    isUploading,
    isProcessing
  };
};

// --- Types ---

interface StatementLineInsert {
  statement_upload_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: string;
  balance: number | null;
  line_sequence: number;
  confidence_score: number;
  has_validation_error: boolean;
  validation_errors: Record<string, string> | null;
  user_excluded: boolean;
}

interface MappingLookups {
  dateCol?: string;
  postedDateCol?: string;
  descCol?: string;
  amountCol?: string;
  debitCol?: string;
  creditCol?: string;
  balanceCol?: string;
}

// --- Helper functions ---

/** Find or create the "Manual Upload" connected bank and ensure its balance row exists. */
async function resolveManualUploadBankId(
  restaurantId: string,
  accountName: string
): Promise<string> {
  const { data: existingBank } = await supabase
    .from('connected_banks')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('institution_name', 'Manual Upload')
    .maybeSingle();

  if (existingBank) {
    await ensureBankBalanceExists(existingBank.id, accountName);
    return existingBank.id;
  }

  // Create a virtual bank for manual uploads
  const { data: newBank, error: bankError } = await supabase
    .from('connected_banks')
    .insert({
      restaurant_id: restaurantId,
      stripe_financial_account_id: `manual_${restaurantId}`,
      institution_name: 'Manual Upload',
      status: 'connected',
      connected_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (bankError || !newBank) {
    throw new Error('Failed to create manual upload bank connection');
  }

  await ensureBankBalanceExists(newBank.id, accountName);
  return newBank.id;
}

/** Ensure a bank_account_balances row exists for the given bank. Creates one if missing. */
async function ensureBankBalanceExists(
  connectedBankId: string,
  accountName: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('bank_account_balances')
    .select('id')
    .eq('connected_bank_id', connectedBankId)
    .maybeSingle();

  if (!existing) {
    await supabase
      .from('bank_account_balances')
      .insert({
        connected_bank_id: connectedBankId,
        account_name: accountName,
        current_balance: 0,
        currency: 'USD',
        as_of_date: new Date().toISOString(),
        is_active: true,
      });
  }
}

function buildMappingLookups(mappings: BankColumnMapping[]): MappingLookups {
  const find = (field: string) => mappings.find((m) => m.targetField === field)?.csvColumn;
  return {
    dateCol: find('transactionDate'),
    postedDateCol: find('postedDate'),
    descCol: find('description'),
    amountCol: find('amount'),
    debitCol: find('debitAmount'),
    creditCol: find('creditAmount'),
    balanceCol: find('balance'),
  };
}

function parseCSVRow(
  row: Record<string, string>,
  lookups: MappingLookups,
  uploadId: string,
  index: number
): { line: StatementLineInsert; amount: number | null } {
  const errors: Record<string, string> = {};

  const rawDate = (lookups.dateCol && row[lookups.dateCol])
    || (lookups.postedDateCol && row[lookups.postedDateCol])
    || '';
  const parsedDate = tryParseDate(rawDate);
  if (!parsedDate) errors.date = `Could not parse date: "${rawDate}"`;

  const description = lookups.descCol ? (row[lookups.descCol] || '').trim() : '';
  if (!description) errors.description = 'Missing description';

  const amount = parseBankAmount(
    lookups.amountCol ? row[lookups.amountCol] : undefined,
    lookups.debitCol ? row[lookups.debitCol] : undefined,
    lookups.creditCol ? row[lookups.creditCol] : undefined
  );
  if (amount === null) errors.amount = 'Could not parse amount';

  const rawBalance = lookups.balanceCol ? row[lookups.balanceCol] : undefined;
  const balance = rawBalance ? parseBankAmount(rawBalance) : null;

  let txnType = 'unknown';
  if (amount !== null) {
    txnType = amount < 0 ? 'debit' : 'credit';
  }

  const hasError = Object.keys(errors).length > 0;

  return {
    line: {
      statement_upload_id: uploadId,
      transaction_date: parsedDate || '1970-01-01',
      description: description || 'Unknown',
      amount: amount ?? 0,
      transaction_type: txnType,
      balance,
      line_sequence: index + 1,
      confidence_score: 1,
      has_validation_error: hasError,
      validation_errors: hasError ? errors : null,
      user_excluded: false,
    },
    amount,
  };
}

async function insertLinesInChunks(lines: StatementLineInsert[]) {
  const CHUNK_SIZE = 100;
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunk = lines.slice(i, i + CHUNK_SIZE);
    const { error: insertError } = await supabase
      .from('bank_statement_lines')
      .insert(chunk);

    if (insertError) {
      if (import.meta.env.DEV) console.error('Error inserting statement lines chunk:', insertError);
      throw insertError;
    }
  }
}

function findBestDuplicateMatch(
  line: { transaction_date: string | null; description: string | null; amount: number | null },
  existingTxns: Array<{ id: string; transaction_date: string | null; description: string | null; amount: number | null }>
): { match: (typeof existingTxns)[0]; confidence: number } | null {
  const matches = existingTxns.filter((txn) => {
    const dateMatch = txn.transaction_date === line.transaction_date;
    const amountDiff = Math.abs((txn.amount || 0) - (line.amount || 0));
    return dateMatch && amountDiff < 0.01;
  });

  if (matches.length === 0) return null;

  let bestMatch = matches[0];
  let bestConfidence = 0.7;

  for (const match of matches) {
    const lineTokens = tokenize(line.description || '');
    const txnTokens = tokenize(match.description || '');
    const overlap = tokenOverlap(lineTokens, txnTokens);
    const confidence = overlap > 0.5 ? 0.95 : 0.7;
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = match;
    }
  }

  return { match: bestMatch, confidence: bestConfidence };
}

/** Format date components as YYYY-MM-DD (timezone-safe) */
function formatLocalDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Try multiple date formats and return YYYY-MM-DD or null */
function tryParseDate(raw: string): string | null {
  if (!raw?.trim()) return null;
  const str = raw.trim();

  // ISO format: 2024-01-15 or 2024-01-15T...
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return formatLocalDate(Number.parseInt(y, 10), Number.parseInt(m, 10), Number.parseInt(d, 10));
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdyMatch = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(str);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const month = Number.parseInt(m, 10);
    const day = Number.parseInt(d, 10);
    const year = Number.parseInt(y, 10);
    const date = new Date(year, month - 1, day);
    if (!Number.isNaN(date.getTime())) return formatLocalDate(year, month, day);
  }

  // MM/DD/YY or M/D/YY
  const mdyShortMatch = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/.exec(str);
  if (mdyShortMatch) {
    const [, m, d, y] = mdyShortMatch;
    const shortYear = Number.parseInt(y, 10);
    const fullYear = shortYear > 50 ? 1900 + shortYear : 2000 + shortYear;
    const month = Number.parseInt(m, 10);
    const day = Number.parseInt(d, 10);
    const date = new Date(fullYear, month - 1, day);
    if (!Number.isNaN(date.getTime())) return formatLocalDate(fullYear, month, day);
  }

  // Try native Date parsing as fallback
  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    return formatLocalDate(fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate());
  }

  return null;
}

/** Tokenize a string into lowercase words */
function tokenize(str: string): Set<string> {
  return new Set(
    str
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

/** Calculate overlap ratio between two token sets */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared++;
  }
  return shared / Math.min(a.size, b.size);
}
