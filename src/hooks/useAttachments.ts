import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import type { Attachment } from '@/components/attachments';

export type AttachmentContext =
  | { type: 'expense'; expenseId: string }
  | { type: 'bank_transaction'; transactionId: string };

interface UseAttachmentsOptions {
  context: AttachmentContext | null;
  linkedExpenseId?: string | null; // For bank transactions that have a linked expense
}

interface ExpenseInvoiceUpload {
  id: string;
  restaurant_id: string;
  pending_outflow_id: string | null;
  raw_file_url: string | null;
  file_name: string | null;
  status: string;
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const useAttachments = ({ context, linkedExpenseId }: UseAttachmentsOptions) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();
  const queryClient = useQueryClient();

  const restaurantId = selectedRestaurant?.restaurant_id;

  // Determine what to fetch based on context
  const expenseIdToFetch = useMemo(() => {
    if (!context) return null;
    if (context.type === 'expense') return context.expenseId;
    // For bank transactions, we might have a linked expense
    return linkedExpenseId || null;
  }, [context, linkedExpenseId]);

  // Fetch attachments for the given expense
  const { data: rawAttachments = [], isLoading } = useQuery({
    queryKey: ['attachments', expenseIdToFetch, restaurantId],
    queryFn: async () => {
      if (!expenseIdToFetch || !restaurantId) return [];

      const { data, error } = await supabase
        .from('expense_invoice_uploads')
        .select('id, raw_file_url, file_name, status, pending_outflow_id')
        .eq('pending_outflow_id', expenseIdToFetch)
        .eq('restaurant_id', restaurantId)
        .not('raw_file_url', 'is', null);

      if (error) throw error;
      return data as ExpenseInvoiceUpload[];
    },
    enabled: !!expenseIdToFetch && !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Convert raw attachments to Attachment format with signed URLs
  const { data: attachments = [], isLoading: isLoadingUrls } = useQuery({
    queryKey: ['attachment-urls', rawAttachments.map((a) => a.id).join(',')],
    queryFn: async () => {
      const result: Attachment[] = [];

      for (const upload of rawAttachments) {
        if (!upload.raw_file_url) continue;

        try {
          const { data: signedUrlData } = await supabase.storage
            .from('receipt-images')
            .createSignedUrl(upload.raw_file_url, 3600);

          if (signedUrlData?.signedUrl) {
            const fileName = upload.file_name || 'attachment';
            const isPdf = fileName.toLowerCase().endsWith('.pdf');

            result.push({
              id: upload.id,
              fileName,
              fileUrl: signedUrlData.signedUrl,
              fileType: isPdf ? 'pdf' : 'image',
              storagePath: upload.raw_file_url,
              isInherited: context?.type === 'bank_transaction' && !!linkedExpenseId,
              inheritedFrom: context?.type === 'bank_transaction' ? 'linked expense' : undefined,
            });
          }
        } catch (error) {
          console.error('Failed to get signed URL for attachment:', upload.id, error);
        }
      }

      return result;
    },
    enabled: rawAttachments.length > 0,
    staleTime: 3000000, // 50 minutes (signed URLs are valid for 1 hour)
  });

  // Upload a new attachment
  const uploadAttachment = useCallback(
    async (file: File): Promise<Attachment | null> => {
      if (!restaurantId) {
        toast({
          title: 'Error',
          description: 'Please select a restaurant first',
          variant: 'destructive',
        });
        return null;
      }

      if (!context) {
        toast({
          title: 'Error',
          description: 'No context provided for attachment',
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
        // Generate unique file path
        const fileExt = file.name.includes('.') ? file.name.split('.').pop() : null;
        const sanitizedBaseName = file.name
          .replace(fileExt ? `.${fileExt}` : '', '')
          .replace(/[^a-zA-Z0-9_-]/g, '_');
        const finalFileName = `${Date.now()}-${sanitizedBaseName}${fileExt ? `.${fileExt}` : ''}`;
        const filePath = `${restaurantId}/expense-invoices/${finalFileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('receipt-images')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Determine which ID to link to
        const pendingOutflowId = context.type === 'expense' ? context.expenseId : null;

        // Create database record
        const { data: invoiceData, error: invoiceError } = await supabase
          .from('expense_invoice_uploads')
          .insert({
            restaurant_id: restaurantId,
            raw_file_url: filePath,
            file_name: file.name,
            file_size: file.size,
            status: 'uploaded',
            pending_outflow_id: pendingOutflowId,
          })
          .select()
          .single();

        if (invoiceError) throw invoiceError;

        // Get signed URL for the uploaded file
        const { data: signedUrlData } = await supabase.storage
          .from('receipt-images')
          .createSignedUrl(filePath, 3600);

        // Invalidate queries to refresh the list
        queryClient.invalidateQueries({ queryKey: ['attachments'] });

        toast({
          title: 'Receipt uploaded',
          description: 'Your receipt has been attached successfully.',
        });

        return {
          id: invoiceData.id,
          fileName: file.name,
          fileUrl: signedUrlData?.signedUrl || '',
          fileType: isPdf ? 'pdf' : 'image',
          storagePath: filePath,
        };
      } catch (error) {
        console.error('Error uploading attachment:', error);
        toast({
          title: 'Upload failed',
          description: 'Failed to upload the file. Please try again.',
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [restaurantId, context, toast, queryClient]
  );

  // Remove an attachment
  const removeAttachment = useMutation({
    mutationFn: async (attachmentId: string) => {
      // First get the file path
      const { data: upload, error: fetchError } = await supabase
        .from('expense_invoice_uploads')
        .select('raw_file_url')
        .eq('id', attachmentId)
        .single();

      if (fetchError) throw fetchError;

      // Delete from storage if we have a file path
      if (upload?.raw_file_url) {
        await supabase.storage.from('receipt-images').remove([upload.raw_file_url]);
      }

      // Delete the database record
      const { error: deleteError } = await supabase
        .from('expense_invoice_uploads')
        .delete()
        .eq('id', attachmentId);

      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
      toast({
        title: 'Attachment removed',
        description: 'The receipt has been removed.',
      });
    },
    onError: (error) => {
      console.error('Error removing attachment:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove the attachment.',
        variant: 'destructive',
      });
    },
  });

  // Download an attachment using blob to avoid domain blocking
  const downloadAttachment = useCallback(
    async (attachment: Attachment) => {
      try {
        // Use blob-based download to avoid domain blocking
        const { data, error } = await supabase.storage
          .from('receipt-images')
          .download(attachment.storagePath);

        if (error || !data) {
          throw new Error('Failed to download file');
        }

        // Create blob URL and trigger download
        const blobUrl = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = attachment.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up blob URL
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (error) {
        console.error('Error downloading attachment:', error);
        toast({
          title: 'Download failed',
          description: 'Failed to download the file.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  return {
    attachments,
    isLoading: isLoading || isLoadingUrls,
    isUploading,
    uploadAttachment,
    removeAttachment: removeAttachment.mutate,
    downloadAttachment,
    hasAttachments: attachments.length > 0,
  };
};
