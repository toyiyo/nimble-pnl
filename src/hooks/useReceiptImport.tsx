import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import * as pdfjsLib from 'pdfjs-dist';

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
      const finalFileName = file.name;

      // Upload file to storage (PDFs will be converted server-side)
      const fileName = `${Date.now()}-${finalFileName}`;
      const filePath = `${selectedRestaurant.restaurant_id}/${fileName}`;
      
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
      // Configure PDF.js worker with absolute URL
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

      let processBlob = imageBlob;
      
      console.log('Processing receipt, file type:', imageBlob.type, 'size:', imageBlob.size);

      // Check if it's a PDF and convert to image
      if (imageBlob.type === 'application/pdf') {
        console.log('Converting PDF to image...');
        try {
          const arrayBuffer = await imageBlob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const page = await pdf.getPage(1); // Get first page
          
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          
          if (!context) {
            throw new Error('Could not get canvas context');
          }
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas
          }).promise;
          
          // Convert canvas to blob
          processBlob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => {
              resolve(blob || imageBlob);
            }, 'image/jpeg', 0.95);
          });
          
          console.log('PDF converted to image successfully');
        } catch (pdfError) {
          console.error('Error converting PDF:', pdfError);
          throw new Error('Failed to convert PDF to image. Please try uploading a JPG or PNG image instead.');
        }
      }

      // Convert blob to base64
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(processBlob);
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

    try {
      const { data, error } = await supabase
        .from('receipt_imports')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Generate signed URLs for all images
      const receiptsWithSignedUrls = await Promise.all(
        (data || []).map(async (receipt) => {
          if (receipt.raw_file_url) {
            try {
              let filePath = receipt.raw_file_url;
              
              // If it's a full URL, extract just the path part
              if (filePath.startsWith('http')) {
                const urlParts = filePath.split('/storage/v1/object/public/receipt-images/');
                if (urlParts.length > 1) {
                  filePath = urlParts[1];
                }
              }
              
              const { data: signedUrlData } = await supabase.storage
                .from('receipt-images')
                .createSignedUrl(filePath, 3600); // 1 hour expiry
              
              if (signedUrlData?.signedUrl) {
                receipt.raw_file_url = signedUrlData.signedUrl;
              }
            } catch (signedUrlError) {
              console.error('Failed to generate signed URL for receipt:', receipt.id, signedUrlError);
            }
          }
          return receipt;
        })
      );

      return receiptsWithSignedUrls as ReceiptImport[];
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

      // Generate signed URL for displaying the image from private bucket
      if (data?.raw_file_url) {
        try {
          let filePath = data.raw_file_url;
          
          // If it's a full URL, extract just the path part
          if (filePath.startsWith('http')) {
            const urlParts = filePath.split('/storage/v1/object/public/receipt-images/');
            if (urlParts.length > 1) {
              filePath = urlParts[1];
            }
          }
          
          const { data: signedUrlData } = await supabase.storage
            .from('receipt-images')
            .createSignedUrl(filePath, 3600); // 1 hour expiry
          
          if (signedUrlData?.signedUrl) {
            data.raw_file_url = signedUrlData.signedUrl;
          }
        } catch (signedUrlError) {
          console.error('Failed to generate signed URL:', signedUrlError);
        }
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

          const { error: stockError } = await supabase
            .from('products')
            .update({
              current_stock: newStock,
              cost_per_unit: item.parsed_price || 0,
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
            unit_cost: item.parsed_price || 0,
            total_cost: (item.parsed_quantity || 0) * (item.parsed_price || 0),
            transaction_type: 'purchase',
            reason: `Receipt import from ${receiptId}`,
            reference_id: `receipt_${receiptId}_${item.id}`
          });

          importedCount++;
        } else if (item.mapping_status === 'new_item') {
          // Create new product with receipt item mapping
          const receiptItemName = item.parsed_name || item.raw_text;
          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert({
              restaurant_id: selectedRestaurant.restaurant_id,
              name: item.parsed_name || item.raw_text,
              sku: `RCP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              current_stock: item.parsed_quantity || 0,
              cost_per_unit: item.parsed_price || 0,
              uom_purchase: item.parsed_unit || 'unit',
              receipt_item_names: [receiptItemName]
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
    getReceiptDetails,
    getReceiptLineItems,
    updateLineItemMapping,
    bulkImportLineItems,
    isUploading,
    isProcessing
  };
};