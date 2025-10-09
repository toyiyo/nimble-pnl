import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

// Get Supabase base URL from the client configuration for environment portability
const getSupabaseUrl = (): string => {
  // Access the base URL from the Supabase client's internal configuration
  // @ts-ignore - accessing internal property for URL
  const url = supabase?.supabaseUrl;
  
  if (!url) {
    console.error('Supabase URL not found in client configuration');
    throw new Error('Supabase configuration error: missing base URL');
  }
  
  return url;
};

// Helper to build proxy endpoint URL
const buildProxyUrl = (receiptId: string): string => {
  const baseUrl = getSupabaseUrl();
  return `${baseUrl}/functions/v1/proxy-receipt-file?receipt_id=${receiptId}`;
};

export interface ReceiptImport {
  id: string;
  restaurant_id: string;
  vendor_name: string | null;
  supplier_id: string | null;
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
      // Sanitize filename to remove special characters
      const fileExt = file.name.split('.').pop();
      const sanitizedBaseName = file.name
        .replace(`.${fileExt}`, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_'); // Replace special chars with underscore
      const finalFileName = `${Date.now()}-${sanitizedBaseName}.${fileExt}`;
      const filePath = `${selectedRestaurant.restaurant_id}/${finalFileName}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipt-images')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // Create receipt import record with just the file path (we'll generate signed URLs when displaying)
      const { data: receiptData, error: receiptError } = await supabase
        .from('receipt_imports')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          raw_file_url: filePath, // Store path instead of public URL
          file_name: file.name,
          file_size: file.size,
          status: 'uploaded'
        })
        .select()
        .single();

      if (receiptError) {
        throw receiptError;
      }

      // PDFs will be converted client-side when processing
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
      console.log('Processing receipt, file type:', imageBlob.type, 'size:', imageBlob.size);

      // For PDFs, we'll send the storage URL instead of base64
      // For images, we'll continue using base64
      let dataToSend: string;
      const isPDF = imageBlob.type === 'application/pdf';

      if (isPDF) {
        // Get the receipt import record to fetch the storage URL
        const { data: receiptData, error: receiptError } = await supabase
          .from('receipt_imports')
          .select('raw_file_url')
          .eq('id', receiptId)
          .single();

        if (receiptError || !receiptData?.raw_file_url) {
          throw new Error('Failed to get PDF storage URL');
        }

        // Generate a signed URL for the PDF (path is already properly formatted)
        const { data: signedUrlData, error: signedUrlError } = await supabase
          .storage
          .from('receipt-images')
          .createSignedUrl(receiptData.raw_file_url, 3600);

        if (signedUrlError || !signedUrlData?.signedUrl) {
          console.error('Failed to create signed URL:', signedUrlError);
          throw new Error('Failed to generate signed URL for PDF');
        }

        dataToSend = signedUrlData.signedUrl;
        console.log('Generated PDF signed URL for processing:', dataToSend.substring(0, 100) + '...');
      } else {
        // Convert image blob to base64
        dataToSend = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(imageBlob);
        });
      }

      // Create AbortController to properly cancel the request on timeout
      const controller = new AbortController();
      let timeoutId: number | undefined;

      try {
        // Set up timeout that aborts the request
        timeoutId = setTimeout(() => {
          controller.abort();
        }, 60000) as unknown as number;

        // Call the edge function with abort signal
        const { data, error } = await supabase.functions.invoke('process-receipt', {
          body: {
            receiptId,
            imageData: dataToSend,
            isPDF
          },
          // @ts-ignore - signal option is supported but not in types yet
          signal: controller.signal
        });

        // Clear timeout on successful completion
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        if (error) {
          throw error;
        }

        toast({
          title: "Success",
          description: `Receipt processed! Found ${data.lineItemsCount} items from ${data.vendor}`,
        });

        return data;
      } catch (error: any) {
        // Clear timeout in case of error
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        // Handle abort specifically
        if (error.name === 'AbortError' || controller.signal.aborted) {
          throw new Error('Receipt processing timed out after 60 seconds');
        }

        throw error;
      }
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

    try {
      const { data, error } = await supabase
        .from('receipt_imports')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Use proxy endpoint for all receipts to avoid Chrome blocking direct Supabase storage URLs
      const receiptsWithProxyUrls = (data || []).map((receipt) => {
        return {
          ...receipt,
          raw_file_url: buildProxyUrl(receipt.id),
        };
      });

      return receiptsWithProxyUrls as ReceiptImport[];
    } catch (error) {
      console.error('Error fetching receipt imports:', error);
      return [];
    }
  };

  const getReceiptDetails = async (receiptId: string) => {
    try {
      const { data, error } = await supabase
        .from('receipt_imports')
        .select('*')
        .eq('id', receiptId)
        .single();

      if (error) throw error;

      // Use proxy endpoint instead of direct signed URLs to avoid Chrome blocking
      if (data) {
        data.raw_file_url = buildProxyUrl(receiptId);
      }

      return data as ReceiptImport;
    } catch (error) {
      console.error('Error fetching receipt details:', error);
      return null;
    }
  };

  const getReceiptLineItems = async (receiptId: string) => {
    const { data, error } = await supabase
      .from('receipt_line_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .order('line_sequence', { ascending: true });

    if (error) {
      console.error('Error fetching receipt line items:', error);
      return [];
    }

    const lineItems = data as ReceiptLineItem[];
    
    // Try to auto-match items that haven't been mapped yet
    await autoMatchLineItems(lineItems);
    
    // Re-fetch the items to get updated mapping status
    const { data: updatedData, error: updatedError } = await supabase
      .from('receipt_line_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .order('line_sequence', { ascending: true });

    if (updatedError) {
      console.error('Error fetching updated receipt line items:', updatedError);
      return lineItems; // Return original data if re-fetch fails
    }

    return updatedData as ReceiptLineItem[];
  };

  const autoMatchLineItems = async (lineItems: ReceiptLineItem[]) => {
    if (!selectedRestaurant?.restaurant_id) return;

    // Load custom abbreviation mappings for this restaurant
    const { ReceiptTextNormalizer } = await import('@/services/receiptTextNormalizer');
    await ReceiptTextNormalizer.loadCustomMappings(selectedRestaurant.restaurant_id);

    for (const item of lineItems) {
      // Skip items that are already mapped
      if (item.mapping_status !== 'pending') continue;

      const searchTerm = item.parsed_name || item.raw_text;
      if (!searchTerm || searchTerm.length < 2) continue;

      try {
        // Generate multiple search variants using the normalizer
        const searchVariants = ReceiptTextNormalizer.generateSearchVariants(searchTerm);
        
        let bestMatch = null;
        let highestScore = 0;

        // Try each search variant
        for (const variant of searchVariants) {
          const { data: matchingProducts, error } = await supabase.rpc('advanced_product_search', {
            p_restaurant_id: selectedRestaurant.restaurant_id,
            p_search_term: variant,
            p_similarity_threshold: 0.2, // Lower threshold for auto-matching
            p_limit: 5
          });

          if (error) {
            console.error('Error auto-matching receipt item:', error);
            continue;
          }

          // Find the best match from this variant
          const topMatch = matchingProducts?.[0];
          if (topMatch && topMatch.combined_score > highestScore) {
            highestScore = topMatch.combined_score;
            bestMatch = topMatch;
          }
        }

        // Auto-map if we found a confident match
        if (bestMatch && (
          bestMatch.match_type === 'receipt_exact' ||  // Exact previous mapping
          bestMatch.match_type === 'exact' ||          // Exact name match
          bestMatch.match_type === 'very_similar' ||   // Very similar names (like PREST vs Prst)
          highestScore > 0.75                          // High confidence fuzzy match (increased from 0.7)
        )) {
          await updateLineItemMapping(item.id, {
            matched_product_id: bestMatch.id,
            mapping_status: 'mapped'
          });

          // Learn from this auto-match for future improvements
          if (bestMatch.match_type !== 'receipt_exact') {
            await ReceiptTextNormalizer.learnFromCorrection(
              selectedRestaurant.restaurant_id,
              searchTerm,
              bestMatch.name
            );
          }
        }
      } catch (error) {
        console.error('Error in auto-matching process:', error);
      }
    }
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
      // Get all mapped line items and receipt details for vendor info
      const [lineItemsResult, receiptResult] = await Promise.all([
        supabase
          .from('receipt_line_items')
          .select('*')
          .eq('receipt_id', receiptId)
          .in('mapping_status', ['mapped', 'new_item']),
        supabase
          .from('receipt_imports')
          .select('vendor_name')
          .eq('id', receiptId)
          .single()
      ]);

      if (lineItemsResult.error) {
        throw lineItemsResult.error;
      }

      const lineItems = lineItemsResult.data;
      const vendorName = receiptResult.data?.vendor_name || null;

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

          // Update existing product stock and store receipt item mapping
          const newStock = (currentProduct.current_stock || 0) + (item.parsed_quantity || 0);
          
          // Get current receipt_item_names to add the new mapping
          const { data: currentProductData, error: currentProductError } = await supabase
            .from('products')
            .select('receipt_item_names')
            .eq('id', item.matched_product_id)
            .single();

          if (currentProductError) {
            console.error('Error fetching current product data:', currentProductError);
            continue;
          }

          // Add the receipt item name to the product's mapping list if not already present
          const currentMappings = currentProductData.receipt_item_names || [];
          const receiptItemName = item.parsed_name || item.raw_text;
          const updatedMappings = currentMappings.includes(receiptItemName) 
            ? currentMappings 
            : [...currentMappings, receiptItemName];

          // Calculate unit price
          const unitPrice = (item.parsed_quantity && item.parsed_quantity > 0) 
            ? (item.parsed_price || 0) / item.parsed_quantity 
            : (item.parsed_price || 0);

          const { error: stockError } = await supabase
            .from('products')
            .update({
              current_stock: newStock,
              cost_per_unit: unitPrice,
              receipt_item_names: updatedMappings,
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
            unit_cost: unitPrice,
            total_cost: item.parsed_price || 0,
            transaction_type: 'purchase',
            reason: `Receipt import from ${receiptId}`,
            reference_id: `receipt_${receiptId}_${item.id}`
          });

          importedCount++;
        } else if (item.mapping_status === 'new_item') {
          // Create new product with receipt item mapping
          const receiptItemName = item.parsed_name || item.raw_text;
          
          // Calculate unit price
          const unitPrice = (item.parsed_quantity && item.parsed_quantity > 0) 
            ? (item.parsed_price || 0) / item.parsed_quantity 
            : (item.parsed_price || 0);

          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert({
              restaurant_id: selectedRestaurant.restaurant_id,
              name: item.parsed_name || item.raw_text,
              sku: `RCP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              current_stock: item.parsed_quantity || 0,
              cost_per_unit: unitPrice,
              uom_purchase: item.parsed_unit || 'unit',
              receipt_item_names: [receiptItemName],
              supplier_name: vendorName
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
            unit_cost: unitPrice,
            total_cost: item.parsed_price || 0,
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
    getReceiptDetails,
    getReceiptLineItems,
    updateLineItemMapping,
    bulkImportLineItems,
    isUploading,
    isProcessing
  };
};