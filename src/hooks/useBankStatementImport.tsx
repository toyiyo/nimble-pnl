import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

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
  created_at: string;
  updated_at: string;
}

export interface BankStatementLine {
  id: string;
  statement_upload_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: string;
  balance: number | null;
  line_sequence: number;
  confidence_score: number | null;
  is_imported: boolean;
  imported_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

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
        }, 60000) as unknown as number;

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
          throw error;
        }

        toast({
          title: "Success",
          description: `Bank statement processed! Found ${data.transactionCount} transactions from ${data.bankName}`,
        });

        return data;
      } catch (error: unknown) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
          throw new Error('Bank statement processing timed out after 60 seconds');
        }

        throw error;
      }
    } catch (error) {
      console.error('Error processing bank statement:', error);
      toast({
        title: "Error",
        description: "Failed to process bank statement",
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
      transaction_date?: string;
      description?: string;
      amount?: number;
      transaction_type?: string;
    }
  ) => {
    const { error } = await supabase
      .from('bank_statement_lines')
      .update(updates)
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

      // We need a connected_bank_id. Since this is a manual upload, we'll create a 
      // virtual "Manual Upload" bank connection if it doesn't exist
      let connectedBankId: string;
      
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

      let importedCount = 0;

      for (const line of lines) {
        // Create bank transaction
        const { data: newTransaction, error: transactionError } = await supabase
          .from('bank_transactions')
          .insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            connected_bank_id: connectedBankId,
            stripe_transaction_id: `manual_${statementUploadId}_${line.id}`,
            transaction_date: line.transaction_date,
            posted_date: line.transaction_date,
            description: line.description,
            amount: line.amount,
            source: 'manual_upload',
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

      toast({
        title: "Success",
        description: `Successfully imported ${importedCount} transactions. Balance updated to ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalBalance)}`,
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
    importStatementLines,
    recalculateBankBalance,
    isUploading,
    isProcessing
  };
};
