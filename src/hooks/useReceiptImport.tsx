import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

export interface ReceiptImport {
  id: string;
  restaurant_id: string;
  vendor_name: string | null;
  raw_file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  processed_at: string | null;
  status: string;
  total_amount: number | null;
  raw_ocr_data: any;
  created_at: string;
  updated_at: string;
  processed_by: string | null;
}

export interface ReceiptLineItem {
  id: string;
  receipt_id: string;
  raw_text: string;
  parsed_name: string | null;
  parsed_quantity: number | null;
  parsed_unit: string | null;
  parsed_price: number | null;
  matched_product_id: string | null;
  confidence_score: number | null;
  mapping_status: string;
  created_at: string;
  updated_at: string;
}

export const useReceiptImport = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();

  const uploadReceipt = async (file: File) => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return null;
    }

    setIsUploading(true);
    try {
      // Upload file to storage
      const fileName = `${Date.now()}-${file.name}`;
      const filePath = `${selectedRestaurant.restaurant_id}/${fileName}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipt-images')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('receipt-images')
        .getPublicUrl(filePath);

      // Create receipt import record
      const { data: receiptData, error: receiptError } = await supabase
        .from('receipt_imports')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          raw_file_url: publicUrl,
          file_name: file.name,
          file_size: file.size,
          status: 'uploaded'
        })
        .select()
        .single();

      if (receiptError) {
        throw receiptError;
      }

      toast({
        title: "Success",
        description: "Receipt uploaded successfully",
      });

      return receiptData;
    } catch (error) {
      console.error('Error uploading receipt:', error);
      toast({
        title: "Error",
        description: "Failed to upload receipt",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const processReceipt = async (receiptId: string, imageBlob: Blob) => {
    setIsProcessing(true);
    try {
      // Convert blob to base64
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(imageBlob);
      });

      // Call the edge function to process the receipt
      const { data, error } = await supabase.functions.invoke('process-receipt', {
        body: {
          receiptId,
          imageData: base64
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Success",
        description: `Receipt processed! Found ${data.lineItemsCount} items from ${data.vendor}`,
      });

      return data;
    } catch (error) {
      console.error('Error processing receipt:', error);
      toast({
        title: "Error",
        description: "Failed to process receipt",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const getReceiptImports = async () => {
    if (!selectedRestaurant?.restaurant_id) return [];

    const { data, error } = await supabase
      .from('receipt_imports')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.restaurant_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching receipt imports:', error);
      return [];
    }

    return data as ReceiptImport[];
  };

  const getReceiptLineItems = async (receiptId: string) => {
    const { data, error } = await supabase
      .from('receipt_line_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching receipt line items:', error);
      return [];
    }

    return data as ReceiptLineItem[];
  };

  const updateLineItemMapping = async (
    lineItemId: string, 
    updates: {
      matched_product_id?: string | null;
      mapping_status?: string;
      parsed_name?: string;
      parsed_quantity?: number;
      parsed_unit?: string;
      parsed_price?: number;
    }
  ) => {
    const { error } = await supabase
      .from('receipt_line_items')
      .update(updates)
      .eq('id', lineItemId);

    if (error) {
      console.error('Error updating line item mapping:', error);
      toast({
        title: "Error",
        description: "Failed to update item mapping",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const bulkImportLineItems = async (receiptId: string) => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return false;
    }

    try {
      // Get all mapped line items
      const { data: lineItems, error: fetchError } = await supabase
        .from('receipt_line_items')
        .select('*')
        .eq('receipt_id', receiptId)
        .in('mapping_status', ['mapped', 'new_item']);

      if (fetchError) {
        throw fetchError;
      }

      let importedCount = 0;

      for (const item of lineItems) {
        if (item.mapping_status === 'mapped' && item.matched_product_id) {
          // First get current stock
          const { data: currentProduct, error: fetchError } = await supabase
            .from('products')
            .select('current_stock')
            .eq('id', item.matched_product_id)
            .single();

          if (fetchError) {
            console.error('Error fetching current product:', fetchError);
            continue;
          }

          // Update existing product stock
          const newStock = (currentProduct.current_stock || 0) + (item.parsed_quantity || 0);
          const { error: stockError } = await supabase
            .from('products')
            .update({
              current_stock: newStock,
              cost_per_unit: item.parsed_price || 0,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.matched_product_id);

          if (stockError) {
            console.error('Error updating product stock:', stockError);
            continue;
          }

          // Log inventory transaction
          await supabase.from('inventory_transactions').insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            product_id: item.matched_product_id,
            quantity: item.parsed_quantity || 0,
            unit_cost: item.parsed_price || 0,
            total_cost: (item.parsed_quantity || 0) * (item.parsed_price || 0),
            transaction_type: 'purchase',
            reason: `Receipt import from ${receiptId}`,
            reference_id: `receipt_${receiptId}_${item.id}`
          });

          importedCount++;
        } else if (item.mapping_status === 'new_item') {
          // Create new product
          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert({
              restaurant_id: selectedRestaurant.restaurant_id,
              name: item.parsed_name || item.raw_text,
              sku: `RCP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              current_stock: item.parsed_quantity || 0,
              cost_per_unit: item.parsed_price || 0,
              uom_purchase: item.parsed_unit || 'unit'
            })
            .select()
            .single();

          if (productError) {
            console.error('Error creating new product:', productError);
            continue;
          }

          // Log inventory transaction for new product
          await supabase.from('inventory_transactions').insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            product_id: newProduct.id,
            quantity: item.parsed_quantity || 0,
            unit_cost: item.parsed_price || 0,
            total_cost: (item.parsed_quantity || 0) * (item.parsed_price || 0),
            transaction_type: 'purchase',
            reason: `Receipt import (new item) from ${receiptId}`,
            reference_id: `receipt_${receiptId}_${item.id}`
          });

          // Update line item with new product ID
          await supabase
            .from('receipt_line_items')
            .update({ matched_product_id: newProduct.id })
            .eq('id', item.id);

          importedCount++;
        }
      }

      // Mark receipt as imported
      await supabase
        .from('receipt_imports')
        .update({ status: 'imported' })
        .eq('id', receiptId);

      toast({
        title: "Success",
        description: `Successfully imported ${importedCount} items to inventory`,
      });

      return true;
    } catch (error) {
      console.error('Error during bulk import:', error);
      toast({
        title: "Error",
        description: "Failed to import items to inventory",
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    uploadReceipt,
    processReceipt,
    getReceiptImports,
    getReceiptLineItems,
    updateLineItemMapping,
    bulkImportLineItems,
    isUploading,
    isProcessing
  };
};