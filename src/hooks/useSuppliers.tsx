import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

export interface Supplier {
  id: string;
  restaurant_id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSupplierData {
  name: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  website?: string;
  notes?: string;
  is_active?: boolean;
}

export const useSuppliers = () => {
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();
  const queryClient = useQueryClient();
  const restaurantId = selectedRestaurant?.restaurant_id;

  // Fetch suppliers with React Query
  const { data: suppliers = [], isLoading: loading } = useQuery({
    queryKey: ['suppliers', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Supplier[];
    },
    enabled: !!restaurantId,
    staleTime: 60_000, // 1 minute
  });

  // Create supplier mutation
  const createMutation = useMutation({
    mutationFn: async (supplierData: CreateSupplierData) => {
      if (!restaurantId) {
        throw new Error('Please select a restaurant first');
      }

      const { data, error } = await supabase
        .from('suppliers')
        .insert({
          restaurant_id: restaurantId,
          ...supplierData
        })
        .select()
        .single();

      if (error) throw error;
      return data as Supplier;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['suppliers', restaurantId], (old: Supplier[] = []) => [...old, data]);
      toast({
        title: "Success",
        description: "Supplier created successfully",
      });
    },
    onError: (error: any) => {
      console.error('Error creating supplier:', error);
      
      // Check for duplicate supplier name
      if (error.code === '23505' && error.message?.includes('suppliers_restaurant_id_name_key')) {
        toast({
          title: "Supplier Already Exists",
          description: "A supplier with this name already exists for your restaurant. Please select the existing supplier or use a different name.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to create supplier",
          variant: "destructive",
        });
      }
    },
  });

  // Update supplier mutation
  const updateMutation = useMutation({
    mutationFn: async ({ supplierId, updates }: { supplierId: string; updates: Partial<CreateSupplierData> }) => {
      const { data, error } = await supabase
        .from('suppliers')
        .update(updates)
        .eq('id', supplierId)
        .select()
        .single();

      if (error) throw error;
      return data as Supplier;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['suppliers', restaurantId], (old: Supplier[] = []) =>
        old.map(supplier => supplier.id === data.id ? data : supplier)
      );
      toast({
        title: "Success",
        description: "Supplier updated successfully",
      });
    },
    onError: (error: any) => {
      console.error('Error updating supplier:', error);
      
      // Check for duplicate supplier name
      if (error.code === '23505' && error.message?.includes('suppliers_restaurant_id_name_key')) {
        toast({
          title: "Duplicate Supplier Name",
          description: "Another supplier with this name already exists for your restaurant. Please choose a different name.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to update supplier",
          variant: "destructive",
        });
      }
    },
  });

  // Delete supplier mutation
  const deleteMutation = useMutation({
    mutationFn: async (supplierId: string) => {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', supplierId);

      if (error) throw error;
      return supplierId;
    },
    onSuccess: (supplierId) => {
      queryClient.setQueryData(['suppliers', restaurantId], (old: Supplier[] = []) =>
        old.filter(supplier => supplier.id !== supplierId)
      );
      toast({
        title: "Success",
        description: "Supplier deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Error deleting supplier:', error);
      toast({
        title: "Error",
        description: "Failed to delete supplier",
        variant: "destructive",
      });
    },
  });

  const createSupplier = async (supplierData: CreateSupplierData) => {
    return createMutation.mutateAsync(supplierData);
  };

  const updateSupplier = async (supplierId: string, updates: Partial<CreateSupplierData>) => {
    return updateMutation.mutateAsync({ supplierId, updates });
  };

  const deleteSupplier = async (supplierId: string) => {
    await deleteMutation.mutateAsync(supplierId);
    return true;
  };

  const fetchSuppliers = () => {
    queryClient.invalidateQueries({ queryKey: ['suppliers', restaurantId] });
  };

  return {
    suppliers,
    loading,
    fetchSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier
  };
};
