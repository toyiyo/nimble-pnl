import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface Customer {
  id: string;
  restaurant_id: string;
  stripe_customer_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_address_city: string | null;
  billing_address_state: string | null;
  billing_address_postal_code: string | null;
  billing_address_country: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerFormData {
  name: string;
  email?: string;
  phone?: string;
  billing_address_line1?: string;
  billing_address_line2?: string;
  billing_address_city?: string;
  billing_address_state?: string;
  billing_address_postal_code?: string;
  billing_address_country?: string;
  notes?: string;
}

export const useCustomers = (restaurantId: string | null) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch customers
  const {
    data: customers = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['customers', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return [];
      }

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true });

      if (error) throw error;

      return (data || []) as Customer[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Create customer
  const createCustomerMutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      if (!restaurantId) {
        throw new Error("No restaurant selected");
      }

      const { data: customer, error } = await supabase
        .from('customers')
        .insert({
          restaurant_id: restaurantId,
          ...data,
        })
        .select()
        .single();

      if (error) throw error;

      return customer as Customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', restaurantId] });
      toast({
        title: "Customer Created",
        description: "The customer has been created successfully",
      });
    },
    onError: (error) => {
      console.error('Error creating customer:', error);
      toast({
        title: "Failed to Create Customer",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Update customer
  const updateCustomerMutation = useMutation({
    mutationFn: async ({ id, ...data }: CustomerFormData & { id: string }) => {
      const { data: customer, error } = await supabase
        .from('customers')
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return customer as Customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', restaurantId] });
      toast({
        title: "Customer Updated",
        description: "The customer has been updated successfully",
      });
    },
    onError: (error) => {
      console.error('Error updating customer:', error);
      toast({
        title: "Failed to Update Customer",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete customer
  const deleteCustomerMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', restaurantId] });
      toast({
        title: "Customer Deleted",
        description: "The customer has been deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Error deleting customer:', error);
      toast({
        title: "Failed to Delete Customer",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Sync customer with Stripe
  const syncCustomerWithStripeMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-create-customer',
        { body: { customerId } }
      );

      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', restaurantId] });
      toast({
        title: "Customer Synced",
        description: "Customer has been synced with Stripe successfully",
      });
    },
    onError: (error) => {
      console.error('Error syncing customer:', error);
      toast({
        title: "Failed to Sync Customer",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  return {
    customers,
    loading,
    error: queryError,
    createCustomer: createCustomerMutation.mutate,
    updateCustomer: updateCustomerMutation.mutate,
    deleteCustomer: deleteCustomerMutation.mutate,
    syncCustomerWithStripe: syncCustomerWithStripeMutation.mutate,
    isCreating: createCustomerMutation.isPending,
    isUpdating: updateCustomerMutation.isPending,
    isDeleting: deleteCustomerMutation.isPending,
    isSyncing: syncCustomerWithStripeMutation.isPending,
  };
};
