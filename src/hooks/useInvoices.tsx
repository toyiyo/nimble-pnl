import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { computeProcessingFeeCents } from "@/lib/invoiceUtils";

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
    phone: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_address_city: string | null;
    billing_address_state: string | null;
    billing_address_postal_code: string | null;
    billing_address_country: string | null;
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

export const useInvoice = (invoiceId: string | null) => {
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
    initialData: !invoiceId ? null : undefined,
  });
};

interface InvoiceTotals {
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
}

function computeInvoiceTotals(lineItems: InvoiceLineItem[], passFeesToCustomer?: boolean): InvoiceTotals {
  const subtotalCents = lineItems.reduce((sum, item) => {
    return sum + Math.round(Number(item.quantity) * Number(item.unit_amount));
  }, 0);
  const feeCents = passFeesToCustomer ? computeProcessingFeeCents(subtotalCents) : 0;
  const totalCents = subtotalCents + feeCents;
  return { subtotalCents, feeCents, totalCents };
}

function buildLineItemRows(
  invoiceId: string,
  lineItems: InvoiceLineItem[],
  feeCents: number,
  passFeesToCustomer?: boolean
): Array<{ invoice_id: string; description: string; quantity: number; unit_amount: number; amount: number }> {
  const rows = lineItems
    .filter(item => item.description.trim() !== '')
    .map(item => ({
      invoice_id: invoiceId,
      description: item.description,
      quantity: Number(item.quantity),
      unit_amount: Math.round(Number(item.unit_amount)),
      amount: Math.round(Number(item.quantity) * Number(item.unit_amount)),
    }));

  if (passFeesToCustomer && feeCents > 0) {
    rows.push({
      invoice_id: invoiceId,
      description: 'Processing Fee',
      quantity: 1,
      unit_amount: feeCents,
      amount: feeCents,
    });
  }

  return rows;
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
      if (result?.error) throw new Error(result.error);

      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      toast({
        title: "Invoice Created",
        description: "The invoice has been created successfully",
      });
      return data;
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
      if (data?.error) throw new Error(data.error);

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
    onSuccess: (data, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
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

  // Create local draft (no Stripe)
  const createLocalDraftMutation = useMutation({
    mutationFn: async (data: InvoiceFormData) => {
      if (!restaurantId) throw new Error("No restaurant selected");

      const { subtotalCents, feeCents, totalCents } = computeInvoiceTotals(data.lineItems, data.passFeesToCustomer);

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          restaurant_id: restaurantId,
          customer_id: data.customerId,
          status: 'draft',
          stripe_invoice_id: null,
          currency: 'usd',
          subtotal: subtotalCents,
          tax: 0,
          total: totalCents,
          amount_due: totalCents,
          amount_paid: 0,
          amount_remaining: totalCents,
          due_date: data.dueDate || null,
          invoice_date: new Date().toISOString().split('T')[0],
          description: data.description || null,
          footer: data.footer || null,
          memo: data.memo || null,
          pass_fees_to_customer: data.passFeesToCustomer || false,
        })
        .select('id')
        .single();

      if (invoiceError) throw invoiceError;

      const lineItemRows = buildLineItemRows(invoice.id, data.lineItems, feeCents, data.passFeesToCustomer);

      if (lineItemRows.length > 0) {
        const { error: itemsError } = await supabase
          .from('invoice_line_items')
          .insert(lineItemRows);
        if (itemsError) throw itemsError;
      }

      return { invoiceId: invoice.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      toast({ title: "Draft Saved", description: "The invoice draft has been saved" });
    },
    onError: (error) => {
      console.error('Error creating draft:', error);
      toast({ title: "Failed to Save Draft", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  // Update existing draft invoice
  const updateInvoiceMutation = useMutation({
    mutationFn: async (data: InvoiceFormData & { invoiceId: string }) => {
      if (!restaurantId) throw new Error("No restaurant selected");

      const { subtotalCents, feeCents, totalCents } = computeInvoiceTotals(data.lineItems, data.passFeesToCustomer);

      const { data: updated, error: updateError } = await supabase
        .from('invoices')
        .update({
          customer_id: data.customerId,
          subtotal: subtotalCents,
          total: totalCents,
          amount_due: totalCents,
          amount_remaining: totalCents,
          due_date: data.dueDate || null,
          description: data.description || null,
          footer: data.footer || null,
          memo: data.memo || null,
          pass_fees_to_customer: data.passFeesToCustomer || false,
        })
        .eq('id', data.invoiceId)
        .eq('restaurant_id', restaurantId)
        .eq('status', 'draft')
        .select('id')
        .single();

      if (updateError) throw updateError;
      if (!updated) throw new Error("Invoice is no longer a draft and cannot be edited");

      // Delete old line items and insert new ones
      const { error: deleteError } = await supabase
        .from('invoice_line_items')
        .delete()
        .eq('invoice_id', data.invoiceId);
      if (deleteError) throw deleteError;

      const lineItemRows = buildLineItemRows(data.invoiceId, data.lineItems, feeCents, data.passFeesToCustomer);

      if (lineItemRows.length > 0) {
        const { error: itemsError } = await supabase
          .from('invoice_line_items')
          .insert(lineItemRows);
        if (itemsError) throw itemsError;
      }

      return { invoiceId: data.invoiceId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['invoice', data.invoiceId] });
      toast({ title: "Invoice Updated", description: "The draft invoice has been updated" });
    },
    onError: (error) => {
      console.error('Error updating invoice:', error);
      toast({ title: "Failed to Update Invoice", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  // Delete draft invoice
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      if (!restaurantId) {
        throw new Error("No restaurant selected");
      }

      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId)
        .eq('restaurant_id', restaurantId)
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
    createInvoice: createInvoiceMutation.mutate,
    createLocalDraft: createLocalDraftMutation.mutate,
    createLocalDraftAsync: createLocalDraftMutation.mutateAsync,
    updateInvoice: updateInvoiceMutation.mutate,
    updateInvoiceAsync: updateInvoiceMutation.mutateAsync,
    sendInvoice: sendInvoiceMutation.mutate,
    sendInvoiceAsync: sendInvoiceMutation.mutateAsync,
    syncInvoiceStatus: syncInvoiceStatusMutation.mutate,
    syncInvoiceStatusAsync: syncInvoiceStatusMutation.mutateAsync,
    deleteInvoice: deleteInvoiceMutation.mutate,
    deleteInvoiceAsync: deleteInvoiceMutation.mutateAsync,
    isCreating: createInvoiceMutation.isPending,
    isCreatingDraft: createLocalDraftMutation.isPending,
    isUpdating: updateInvoiceMutation.isPending,
    isSending: sendInvoiceMutation.isPending,
    isSyncingStatus: syncInvoiceStatusMutation.isPending,
    isDeleting: deleteInvoiceMutation.isPending,
    createdInvoice: createInvoiceMutation.data,
    createdDraft: createLocalDraftMutation.data,
  };
};
