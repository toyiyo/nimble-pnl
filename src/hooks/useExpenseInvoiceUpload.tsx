import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

export interface ExpenseInvoiceUpload {
  id: string;
  restaurant_id: string;
  pending_outflow_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_amount: number | null;
  raw_file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  status: string;
  raw_ocr_data: Record<string, unknown> | null;
  field_confidence: Record<string, number | null> | null;
  processed_at: string | null;
  processed_by: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const useExpenseInvoiceUpload = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();

  const uploadInvoice = async (file: File) => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: 'Error',
        description: 'Please select a restaurant first',
        variant: 'destructive',
      });
      return null;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');
    if (!isPdf && !isImage) {
      toast({
        title: 'Unsupported file',
        description: 'Please upload a PDF or image file.',
        variant: 'destructive',
      });
      return null;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      toast({
        title: 'File Too Large',
        description: `Your file is ${fileSizeMB}MB. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
        variant: 'destructive',
      });
      return null;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.includes('.') ? file.name.split('.').pop() : null;
      const sanitizedBaseName = file.name
        .replace(fileExt ? `.${fileExt}` : '', '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const finalFileName = `${Date.now()}-${sanitizedBaseName}${fileExt ? `.${fileExt}` : ''}`;
      const filePath = `${selectedRestaurant.restaurant_id}/expense-invoices/${finalFileName}`;

      const { error: uploadError } = await supabase.storage
        .from('receipt-images')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data: invoiceData, error: invoiceError } = await supabase
        .from('expense_invoice_uploads')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          raw_file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          status: 'uploaded',
        })
        .select()
        .single();

      if (invoiceError) {
        throw invoiceError;
      }

      return invoiceData as ExpenseInvoiceUpload;
    } catch (error) {
      console.error('Error uploading invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload invoice',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const processInvoice = async (invoiceUploadId: string, file: File) => {
    setIsProcessing(true);
    try {
      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      let dataToSend: string;

      if (isPDF) {
        const { data: invoiceData, error: invoiceError } = await supabase
          .from('expense_invoice_uploads')
          .select('raw_file_url')
          .eq('id', invoiceUploadId)
          .single();

        if (invoiceError || !invoiceData?.raw_file_url) {
          throw new Error('Failed to get invoice storage URL');
        }

        const { data: signedUrlData, error: signedUrlError } = await supabase
          .storage
          .from('receipt-images')
          .createSignedUrl(invoiceData.raw_file_url, 3600);

        if (signedUrlError || !signedUrlData?.signedUrl) {
          throw new Error('Failed to generate signed URL for invoice');
        }

        dataToSend = signedUrlData.signedUrl;
      } else {
        dataToSend = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }

      const controller = new AbortController();
      let timeoutId: number | undefined;

      try {
        timeoutId = setTimeout(() => {
          controller.abort();
        }, 60000) as unknown as number;

        const { data, error } = await supabase.functions.invoke('process-expense-invoice', {
          body: {
            invoiceUploadId,
            imageData: dataToSend,
            isPDF,
          },
          // @ts-expect-error - signal option is supported but not in types yet
          signal: controller.signal,
        });

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        if (error) {
          throw error;
        }

        return data;
      } catch (error: any) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        if (error.name === 'AbortError' || controller.signal.aborted) {
          throw new Error('Invoice processing timed out after 60 seconds');
        }

        throw error;
      }
    } catch (error) {
      console.error('Error processing invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to process invoice',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const updateInvoiceUpload = async (invoiceUploadId: string, updates: Partial<ExpenseInvoiceUpload>) => {
    const { data, error } = await supabase
      .from('expense_invoice_uploads')
      .update(updates)
      .eq('id', invoiceUploadId)
      .select()
      .single();

    if (error) {
      console.error('Error updating invoice upload:', error);
      return null;
    }

    return data as ExpenseInvoiceUpload;
  };

  return {
    uploadInvoice,
    processInvoice,
    updateInvoiceUpload,
    isUploading,
    isProcessing,
  };
};
