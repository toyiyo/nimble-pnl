import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { WEIGHT_UNITS, VOLUME_UNITS } from '@/lib/enhancedUnitConversion';
import { calculateImportedTotal, calculateUnitPrice } from '@/utils/receiptImportUtils';

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
  imported_total: number | null;
  raw_ocr_data: any;
  created_at: string;
  updated_at: string;
  processed_by: string | null;
  purchase_date: string | null;
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
  parsed_unit: string | null;  // DEPRECATED: Use package_type + size_unit instead
  parsed_price: number | null;
  parsed_sku: string | null;  // SKU for barcode scanning
  unit_price?: number | null;  // Price per unit
  package_type: string | null;  // Type of container (bottle, bag, case, etc.)
  size_value: number | null;    // Amount per package (750 for 750ml bottle)
  size_unit: string | null;     // Unit of measurement (ml, oz, lb, etc.)
  matched_product_id: string | null;
  confidence_score: number | null;
  mapping_status: string;
  created_at: string;
  updated_at: string;
  // Suggested values from matched products (for UI hints)
  suggested_size_value?: number | null;
  suggested_size_unit?: string | null;
  suggested_package_type?: string | null;
}

// Combined set of measurement units (weight + volume) for quick lookup
const MEASUREMENT_UNITS_SET = new Set([...WEIGHT_UNITS, ...VOLUME_UNITS].map(u => u.toLowerCase()));

// Check if a unit is a measurement unit (where quantity represents size)
const isMeasurementUnit = (unit: string | null | undefined): boolean => {
  if (!unit) return false;
  const normalized = normalizeUnit(unit);
  return MEASUREMENT_UNITS_SET.has(normalized.toLowerCase());
};

// Normalize unit for storage (standardize common variations)
const normalizeUnit = (unit: string | null | undefined): string => {
  if (!unit) return 'unit';
  const normalized = unit.toLowerCase().trim();
  // Standardize common variations
  if (normalized === 'lbs') return 'lb';
  if (normalized === 'gallon' || normalized === 'gallons') return 'gal';
  if (normalized === 'quart' || normalized === 'quarts') return 'qt';
  if (normalized === 'pint' || normalized === 'pints') return 'pt';
  if (normalized === 'liter' || normalized === 'liters') return 'l';
  if (normalized === 'gram' || normalized === 'grams') return 'g';
  return unit;
};

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

    // Enrich line items with product catalog data for suggestions
    const enrichedItems = await enrichLineItemsWithProductData(updatedData as ReceiptLineItem[]);

    return enrichedItems;
  };

  // Enrich line items with suggested size/package data from matched products
  const enrichLineItemsWithProductData = async (lineItems: ReceiptLineItem[]): Promise<ReceiptLineItem[]> => {
    if (!selectedRestaurant?.restaurant_id) return lineItems;

    // Get all unique matched product IDs
    const matchedProductIds = lineItems
      .filter(item => item.matched_product_id)
      .map(item => item.matched_product_id!)
      .filter((id, index, arr) => arr.indexOf(id) === index);

    if (matchedProductIds.length === 0) return lineItems;

    // Fetch matched products with size info (uom_purchase = package type)
    const { data: matchedProducts, error } = await supabase
      .from('products')
      .select('id, size_value, size_unit, uom_purchase')
      .in('id', matchedProductIds);

    if (error) {
      console.error('Error fetching matched products for enrichment:', error);
      return lineItems;
    }

    // Create a map for quick lookup
    const productMap = new Map(matchedProducts?.map(p => [p.id, p]) || []);

    // Enrich each line item
    return lineItems.map(item => {
      if (!item.matched_product_id) return item;

      const matchedProduct = productMap.get(item.matched_product_id);
      if (!matchedProduct) return item;

      // Add suggestions if line item is missing size info but product has it
      const enrichedItem = { ...item };
      
      if (!item.size_value && matchedProduct.size_value) {
        enrichedItem.suggested_size_value = matchedProduct.size_value;
      }
      if (!item.size_unit && matchedProduct.size_unit) {
        enrichedItem.suggested_size_unit = matchedProduct.size_unit;
      }
      // uom_purchase in products table serves as the package type
      if (!item.package_type && matchedProduct.uom_purchase) {
        enrichedItem.suggested_package_type = matchedProduct.uom_purchase;
      }

      return enrichedItem;
    });
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
      parsed_sku?: string;
      package_type?: string | null;
      size_value?: number | null;
      size_unit?: string | null;
      unit_price?: number | null;
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
      // Get all mapped line items and receipt details for vendor info, supplier_id, AND purchase_date
      const [lineItemsResult, receiptResult] = await Promise.all([
        supabase
          .from('receipt_line_items')
          .select('*')
          .eq('receipt_id', receiptId)
          .in('mapping_status', ['mapped', 'new_item']),
        supabase
          .from('receipt_imports')
          .select('vendor_name, supplier_id, purchase_date')
          .eq('id', receiptId)
          .single()
      ]);

      if (lineItemsResult.error) {
        throw lineItemsResult.error;
      }

      const lineItems = lineItemsResult.data;
      const vendorName = receiptResult.data?.vendor_name || null;
      const supplierId = receiptResult.data?.supplier_id || null;
      const purchaseDate = receiptResult.data?.purchase_date || null;

      let importedCount = 0;
      // Track created products by parsed_name to reuse for duplicates
      const createdProducts = new Map<string, string>(); // parsed_name (lowercase) -> product_id

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

          const unitPrice = calculateUnitPrice(item);

          const { error: stockError } = await supabase
            .from('products')
            .update({
              current_stock: newStock,
              cost_per_unit: unitPrice,
              receipt_item_names: updatedMappings,
              supplier_id: supplierId,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.matched_product_id);

          if (stockError) {
            console.error('Error updating product stock:', stockError);
            continue;
          }

          // Log inventory transaction WITH supplier tracking and purchase date
          await supabase.from('inventory_transactions').insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            product_id: item.matched_product_id,
            quantity: item.parsed_quantity || 0,
            unit_cost: unitPrice,
            total_cost: item.parsed_price || 0,
            transaction_type: 'purchase',
            reason: `Receipt import from ${receiptId}${vendorName ? ` - ${vendorName}` : ''}`,
            reference_id: `receipt_${receiptId}_${item.id}`,
            supplier_id: supplierId,  // Track which supplier this purchase came from
            transaction_date: purchaseDate  // Use actual purchase date from receipt
          });

          // Create or update product-supplier relationship
          if (supplierId) {
            const { error: supplierError } = await supabase.rpc('upsert_product_supplier', {
              p_restaurant_id: selectedRestaurant.restaurant_id,
              p_product_id: item.matched_product_id,
              p_supplier_id: supplierId,
              p_unit_cost: unitPrice,
              p_quantity: item.parsed_quantity || 0
            });

            if (supplierError) {
              console.error('Error updating product-supplier relationship:', supplierError);
              // Don't throw - this is supplemental data
            }
          }

          importedCount++;
        } else if (item.mapping_status === 'new_item') {
          // Create new product with receipt item mapping
          const receiptItemName = item.parsed_name || item.raw_text;
          const itemNameKey = receiptItemName.toLowerCase().trim();
          
          const unitPrice = calculateUnitPrice(item);

          // Check if we already created this product from a previous line item
          if (createdProducts.has(itemNameKey)) {
            const existingProductId = createdProducts.get(itemNameKey)!;
            
            // Get current stock for the existing product
            const { data: existingProduct, error: fetchError } = await supabase
              .from('products')
              .select('current_stock')
              .eq('id', existingProductId)
              .single();

            if (fetchError) {
              console.error('Error fetching existing product:', fetchError);
              continue;
            }

            // Update stock for the existing product
            const newStock = (existingProduct.current_stock || 0) + (item.parsed_quantity || 0);
            
            const { error: stockError } = await supabase
              .from('products')
              .update({
                current_stock: newStock,
                updated_at: new Date().toISOString()
              })
              .eq('id', existingProductId);

            if (stockError) {
              console.error('Error updating product stock:', stockError);
              continue;
            }

            // Log inventory transaction for the existing product
            await supabase.from('inventory_transactions').insert({
              restaurant_id: selectedRestaurant.restaurant_id,
              product_id: existingProductId,
              quantity: item.parsed_quantity || 0,
              unit_cost: unitPrice,
              total_cost: item.parsed_price || 0,
              transaction_type: 'purchase',
              reason: `Receipt import (duplicate item) from ${receiptId}${vendorName ? ` - ${vendorName}` : ''}`,
              reference_id: `receipt_${receiptId}_${item.id}`,
              supplier_id: supplierId,
              transaction_date: purchaseDate
            });

            // Update line item to reference the existing product
            await supabase
              .from('receipt_line_items')
              .update({ matched_product_id: existingProductId })
              .eq('id', item.id);

            importedCount++;
            continue; // Skip to next item
          }

          // Product doesn't exist yet - create it (first occurrence)
          // Determine package type and size info
          const packageType = item.package_type || item.parsed_unit || 'unit';
          const sizeValue = item.size_value || item.parsed_quantity || 0;
          const sizeUnit = item.size_unit || null;
          
          // Build product data with size/packaging info
          const productData: Record<string, any> = {
            restaurant_id: selectedRestaurant.restaurant_id,
            name: item.parsed_name || item.raw_text,
            sku: item.parsed_sku || `RCP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            current_stock: item.parsed_quantity || 0,
            cost_per_unit: unitPrice,
            uom_purchase: packageType,  // Use package_type if available
            receipt_item_names: [receiptItemName],
            supplier_id: supplierId,
            supplier_name: vendorName
          };

          // Set size info if we have it (for both measurement units AND containers with size)
          if (sizeUnit && sizeValue > 0) {
            productData.size_unit = sizeUnit;
            productData.size_value = sizeValue;
            console.log(`📦 Setting package size for ${item.parsed_name}: ${sizeValue} ${sizeUnit} per ${packageType}`);
          }

          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert(productData as any)
            .select()
            .single();

          if (productError) {
            console.error('Error creating new product:', productError);
            continue;
          }

          // Track this product for subsequent duplicates
          createdProducts.set(itemNameKey, newProduct.id);

          // Log inventory transaction for new product WITH supplier tracking and purchase date
          await supabase.from('inventory_transactions').insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            product_id: newProduct.id,
            quantity: item.parsed_quantity || 0,
            unit_cost: unitPrice,
            total_cost: item.parsed_price || 0,
            transaction_type: 'purchase',
            reason: `Receipt import (new item) from ${receiptId}${vendorName ? ` - ${vendorName}` : ''}`,
            reference_id: `receipt_${receiptId}_${item.id}`,
            supplier_id: supplierId,  // Track which supplier this purchase came from
            transaction_date: purchaseDate  // Use actual purchase date from receipt
          });

          // Create product-supplier relationship for new product
          if (supplierId) {
            const { error: supplierError } = await supabase
              .from('product_suppliers')
              .insert({
                restaurant_id: selectedRestaurant.restaurant_id,
                product_id: newProduct.id,
                supplier_id: supplierId,
                last_unit_cost: unitPrice,
                last_purchase_date: purchaseDate || new Date().toISOString(),
                last_purchase_quantity: item.parsed_quantity || 0,
                average_unit_cost: unitPrice,
                purchase_count: 1,
                is_preferred: true  // First supplier is default preferred
              });

            if (supplierError) {
              console.error('Error creating product-supplier relationship:', supplierError);
              // Don't throw - this is supplemental data
            }
          }

          // Update line item with new product ID
          await supabase
            .from('receipt_line_items')
            .update({ matched_product_id: newProduct.id })
            .eq('id', item.id);

          importedCount++;
        }
      }

      const importedTotal = calculateImportedTotal(lineItems);

      // Mark receipt as imported with calculated total
      const { error: statusError } = await supabase
        .from('receipt_imports')
        .update({
          status: 'imported',
          imported_total: importedTotal
        })
        .eq('id', receiptId);

      if (statusError) {
        console.error('Error marking receipt as imported:', statusError);
        toast({
          title: "Warning",
          description: "Items were imported but receipt status failed to update. Please verify.",
          variant: "destructive",
        });
        return true;
      }

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