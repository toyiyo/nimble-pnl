import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface InvoiceLineItem {
  id?: string;
  invoice_id?: string;
  stripe_invoice_item_id?: string;
  description: string;
  quantity: number;
  unit_amount: number;
  amount?: number;
  tax_behavior?: 'inclusive' | 'exclusive' | 'unspecified';
  tax_rate?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Invoice {
  id: string;
  restaurant_id: string;
  customer_id: string;
  stripe_invoice_id: string | null;
  invoice_number: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  due_date: string | null;
  invoice_date: string;
  paid_at: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  stripe_fee_amount: number;
  stripe_fee_description: string | null;
  application_fee_amount: number;
  pass_fees_to_customer: boolean;
  description: string | null;
  footer: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  customers?: {
    name: string;
    email: string | null;
  };
  invoice_line_items?: InvoiceLineItem[];
}

export interface InvoiceFormData {
  customerId: string;
  lineItems: InvoiceLineItem[];
  dueDate?: string;
  description?: string;
  footer?: string;
  memo?: string;
  passFeesToCustomer?: boolean;
}

export const useInvoices = (restaurantId: string | null) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch invoices
  const {
    data: invoices = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['invoices', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return [];
      }

      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          customers (
            name,
            email
          ),
          invoice_line_items (*)
        `)
        .eq('restaurant_id', restaurantId)
        .order('invoice_date', { ascending: false });

      if (error) throw error;

      return (data || []) as Invoice[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Get single invoice
  const useInvoice = (invoiceId: string | null) => {
    return useQuery({
      queryKey: ['invoice', invoiceId],
      queryFn: async () => {
        if (!invoiceId) {
          return null;
        }

        const { data, error } = await supabase
          .from('invoices')
          .select(`
            *,
            customers (
              name,
              email,
              phone,
              billing_address_line1,
              billing_address_line2,
              billing_address_city,
              billing_address_state,
              billing_address_postal_code,
              billing_address_country
            ),
            invoice_line_items (*)
          `)
          .eq('id', invoiceId)
          .single();

        if (error) throw error;

        return data as Invoice;
      },
      enabled: !!invoiceId,
      staleTime: 30000,
    });
  };

  // Create invoice
  const createInvoiceMutation = useMutation({
    mutationFn: async (data: InvoiceFormData) => {
      if (!restaurantId) {
        throw new Error("No restaurant selected");
      }

      const { data: result, error } = await supabase.functions.invoke(
        'stripe-create-invoice',
        {
          body: {
            restaurantId,
            ...data,
          }
        }
      );

      if (error) throw error;

      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      toast({
        title: "Invoice Created",
        description: "The invoice has been created successfully",
      });
      return data; // Return the created invoice data
    },
    onError: (error) => {
      console.error('Error creating invoice:', error);
      toast({
        title: "Failed to Create Invoice",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Send invoice
  const sendInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-send-invoice',
        { body: { invoiceId } }
      );

      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      toast({
        title: "Invoice Sent",
        description: "The invoice has been sent to the customer",
      });
    },
    onError: (error) => {
      console.error('Error sending invoice:', error);
      toast({
        title: "Failed to Send Invoice",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Sync invoice status from Stripe
  const syncInvoiceStatusMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-sync-invoice-status',
        { body: { invoiceId } }
      );

      if (error) throw error;

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['invoice', data?.invoiceId] });
      toast({
        title: "Invoice Status Updated",
        description: `Status: ${data?.status}`,
      });
    },
    onError: (error) => {
      console.error('Error syncing invoice status:', error);
      toast({
        title: "Failed to Sync Invoice Status",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete draft invoice
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId)
        .eq('status', 'draft'); // Only allow deleting drafts

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      toast({
        title: "Invoice Deleted",
        description: "The invoice has been deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Error deleting invoice:', error);
      toast({
        title: "Failed to Delete Invoice",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  return {
    invoices,
    loading,
    error: queryError,
    useInvoice,
    createInvoice: createInvoiceMutation.mutate,
    sendInvoice: sendInvoiceMutation.mutate,
    syncInvoiceStatus: syncInvoiceStatusMutation.mutate,
    deleteInvoice: deleteInvoiceMutation.mutate,
    isCreating: createInvoiceMutation.isPending,
    isSending: sendInvoiceMutation.isPending,
    isSyncingStatus: syncInvoiceStatusMutation.isPending,
    isDeleting: deleteInvoiceMutation.isPending,
    createdInvoice: createInvoiceMutation.data,
  };
};
