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
  validation_errors: any | null;
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
          variant: data.invalidTransactionCount > 0 ? "default" : "default",
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
    
    const updateData: any = { ...updates };
    
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

        // Ensure bank account balance entry exists
        const { data: existingBalance } = await supabase
          .from('bank_account_balances')
          .select('id')
          .eq('connected_bank_id', connectedBankId)
          .maybeSingle();

        if (!existingBalance) {
          await supabase
            .from('bank_account_balances')
            .insert({
              connected_bank_id: connectedBankId,
              account_name: statement.bank_name || 'CSV Import Account',
              current_balance: 0,
              currency: 'USD',
              as_of_date: new Date().toISOString(),
              is_active: true,
            });
        }
      } else {
        // Check if manual upload bank exists
        const { data: existingBank } = await supabase
          .from('connected_banks')
          .select('id')
          .eq('restaurant_id', selectedRestaurant.restaurant_id)
          .eq('institution_name', 'Manual Upload')
          .maybeSingle();

        if (existingBank) {
          connectedBankId = existingBank.id;

          // Check if bank account balance exists, create if missing
          const { data: existingBalance } = await supabase
            .from('bank_account_balances')
            .select('id')
            .eq('connected_bank_id', connectedBankId)
            .maybeSingle();

          if (!existingBalance) {
            await supabase
              .from('bank_account_balances')
              .insert({
                connected_bank_id: connectedBankId,
                account_name: statement.bank_name || 'Manual Upload Account',
                current_balance: 0,
                currency: 'USD',
                as_of_date: new Date().toISOString(),
                is_active: true,
              });
          }
        } else {
          // Create a virtual bank for manual uploads
          const { data: newBank, error: bankError } = await supabase
            .from('connected_banks')
            .insert({
              restaurant_id: selectedRestaurant.restaurant_id,
              stripe_financial_account_id: `manual_${selectedRestaurant.restaurant_id}`,
              institution_name: 'Manual Upload',
              status: 'connected',
              connected_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (bankError || !newBank) {
            throw new Error('Failed to create manual upload bank connection');
          }

          connectedBankId = newBank.id;

          // Create a default bank account balance entry for the manual upload
          await supabase
            .from('bank_account_balances')
            .insert({
              connected_bank_id: connectedBankId,
              account_name: statement.bank_name || 'Manual Upload Account',
              current_balance: 0, // Will be updated after transactions are imported
              currency: 'USD',
              as_of_date: new Date().toISOString(),
              is_active: true,
            });
        }
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

      // Build mapping lookups
      const dateCol = mappings.find((m) => m.targetField === 'transactionDate')?.csvColumn;
      const postedDateCol = mappings.find((m) => m.targetField === 'postedDate')?.csvColumn;
      const descCol = mappings.find((m) => m.targetField === 'description')?.csvColumn;
      const amountCol = mappings.find((m) => m.targetField === 'amount')?.csvColumn;
      const debitCol = mappings.find((m) => m.targetField === 'debitAmount')?.csvColumn;
      const creditCol = mappings.find((m) => m.targetField === 'creditAmount')?.csvColumn;
      const balanceCol = mappings.find((m) => m.targetField === 'balance')?.csvColumn;

      // Transform rows
      const lines: any[] = [];
      let totalDebits = 0;
      let totalCredits = 0;

      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i];
        const errors: Record<string, string> = {};

        // Parse date
        const rawDate = dateCol ? row[dateCol] : postedDateCol ? row[postedDateCol] : '';
        const parsedDate = tryParseDate(rawDate || '');
        if (!parsedDate) {
          errors.date = `Could not parse date: "${rawDate}"`;
        }

        // Parse description
        const description = descCol ? (row[descCol] || '').trim() : '';
        if (!description) {
          errors.description = 'Missing description';
        }

        // Parse amount
        const amount = parseBankAmount(
          amountCol ? row[amountCol] : undefined,
          debitCol ? row[debitCol] : undefined,
          creditCol ? row[creditCol] : undefined
        );
        if (amount === null) {
          errors.amount = 'Could not parse amount';
        }

        // Parse balance
        const rawBalance = balanceCol ? row[balanceCol] : undefined;
        const balance = rawBalance ? parseBankAmount(rawBalance) : null;

        // Determine transaction type
        const txnType = amount !== null ? (amount < 0 ? 'debit' : 'credit') : 'unknown';

        // Track totals
        if (amount !== null) {
          if (amount < 0) totalDebits += Math.abs(amount);
          else totalCredits += amount;
        }

        const hasError = Object.keys(errors).length > 0;

        lines.push({
          statement_upload_id: uploadId,
          transaction_date: parsedDate || '1970-01-01', // placeholder for NOT NULL
          description: description || 'Unknown',
          amount: amount ?? 0, // placeholder for NOT NULL
          transaction_type: txnType,
          balance,
          line_sequence: i + 1,
          confidence_score: 1.0,
          has_validation_error: hasError,
          validation_errors: hasError ? errors : null,
          user_excluded: false,
        });
      }

      // Batch insert in chunks of 100
      const CHUNK_SIZE = 100;
      for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        const chunk = lines.slice(i, i + CHUNK_SIZE);
        const { error: insertError } = await supabase
          .from('bank_statement_lines')
          .insert(chunk);

        if (insertError) {
          console.error('Error inserting statement lines chunk:', insertError);
          throw insertError;
        }
      }

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
      console.error('Error staging CSV statement:', error);
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
        .sort();
      if (dates.length === 0) return 0;

      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

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
        // Find matches: same date and very close amount
        const matches = existingTxns.filter((txn) => {
          const dateMatch = txn.transaction_date === line.transaction_date;
          const amountDiff = Math.abs((txn.amount || 0) - (line.amount || 0));
          return dateMatch && amountDiff < 0.01;
        });

        if (matches.length > 0) {
          // Pick best match based on description similarity
          let bestMatch = matches[0];
          let bestConfidence = 0.7; // Base confidence for date+amount match

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

          // Update the staged line
          await supabase
            .from('bank_statement_lines')
            .update({
              is_potential_duplicate: true,
              duplicate_transaction_id: bestMatch.id,
              duplicate_confidence: bestConfidence,
              user_excluded: bestConfidence >= 0.9, // Auto-exclude high confidence
            })
            .eq('id', line.id);

          flaggedCount++;
        }
      }

      return flaggedCount;
    } catch (error) {
      console.error('Error detecting duplicates:', error);
      return 0;
    }
  };

  const recalculateBankBalance = async (connectedBankId: string) => {
    try {
      // Get all transactions for this bank
      const { data: allTransactions, error: transError } = await supabase
        .from('bank_transactions')
        .select('amount')
        .eq('connected_bank_id', connectedBankId);

      if (transError) throw transError;

      const totalBalance = allTransactions?.reduce((sum, t) => sum + t.amount, 0) || 0;

      // Update or create the bank account balance
      const { data: existingBalance } = await supabase
        .from('bank_account_balances')
        .select('id')
        .eq('connected_bank_id', connectedBankId)
        .maybeSingle();

      if (existingBalance) {
        await supabase
          .from('bank_account_balances')
          .update({
            current_balance: totalBalance,
            as_of_date: new Date().toISOString(),
          })
          .eq('connected_bank_id', connectedBankId);
      } else {
        // Create balance entry if missing
        await supabase
          .from('bank_account_balances')
          .insert({
            connected_bank_id: connectedBankId,
            account_name: 'Manual Upload Account',
            current_balance: totalBalance,
            currency: 'USD',
            as_of_date: new Date().toISOString(),
            is_active: true,
          });
      }

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

// --- Helper functions ---

/** Try multiple date formats and return YYYY-MM-DD or null */
function tryParseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const str = raw.trim();

  // ISO format: 2024-01-15 or 2024-01-15T...
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }

  // MM/DD/YY or M/D/YY
  const mdyShortMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (mdyShortMatch) {
    const [, m, d, y] = mdyShortMatch;
    const fullYear = parseInt(y) + (parseInt(y) > 50 ? 1900 : 2000);
    const date = new Date(fullYear, parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }

  // Try native Date parsing as fallback
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().split('T')[0];

  return null;
}

/** Tokenize a string into lowercase words */
function tokenize(str: string): Set<string> {
  return new Set(
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
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
