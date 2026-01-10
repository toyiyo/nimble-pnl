import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useReceiptImport, ReceiptLineItem, ReceiptImport } from '@/hooks/useReceiptImport';
import { useProducts } from '@/hooks/useProducts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { SearchableSupplierSelector } from '@/components/SearchableSupplierSelector';
import { ReceiptStatusBar, ReceiptItemRow, ReceiptBatchActions } from '@/components/receipt';
import { 
  Package, Image, FileText, Download, CalendarIcon, 
  AlertCircle, CheckCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface ReceiptMappingReviewProps {
  receiptId: string;
  onImportComplete: () => void;
}

type ConfidenceTier = 'auto-approved' | 'quick-review' | 'needs-attention';

// Determine tier based on confidence and mapping status
const getItemTier = (item: ReceiptLineItem): ConfidenceTier => {
  // Already resolved items (mapped or new_item with high confidence)
  if (item.mapping_status === 'mapped' || item.mapping_status === 'skipped') {
    return 'auto-approved';
  }
  if (item.mapping_status === 'new_item' && item.confidence_score && item.confidence_score >= 0.85) {
    return 'auto-approved';
  }
  
  // Items with moderate confidence or new_item status
  if (item.confidence_score && item.confidence_score >= 0.6) {
    return 'quick-review';
  }
  if (item.mapping_status === 'new_item') {
    return 'quick-review';
  }
  
  // Everything else needs attention
  return 'needs-attention';
};

// Category-based quick-fill options
const getCategoryQuickFills = (category: string | undefined) => {
  const normalizedCategory = (category || '').toLowerCase();
  
  const quickFills: { label: string; sizeValue: number; sizeUnit: string; packageType?: string }[] = [];
  
  if (normalizedCategory.includes('beverage') || normalizedCategory.includes('drink') || normalizedCategory.includes('soda') || normalizedCategory.includes('juice')) {
    quickFills.push(
      { label: '12 fl oz can', sizeValue: 12, sizeUnit: 'fl oz', packageType: 'can' },
      { label: '16 fl oz bottle', sizeValue: 16, sizeUnit: 'fl oz', packageType: 'bottle' },
      { label: '20 fl oz bottle', sizeValue: 20, sizeUnit: 'fl oz', packageType: 'bottle' },
      { label: '2 L bottle', sizeValue: 2, sizeUnit: 'L', packageType: 'bottle' },
      { label: '1 gal jug', sizeValue: 1, sizeUnit: 'gal', packageType: 'jug' }
    );
  } else if (normalizedCategory.includes('dairy') || normalizedCategory.includes('yogurt') || normalizedCategory.includes('milk')) {
    quickFills.push(
      { label: '8 oz container', sizeValue: 8, sizeUnit: 'oz', packageType: 'container' },
      { label: '16 oz container', sizeValue: 16, sizeUnit: 'oz', packageType: 'container' },
      { label: '32 oz container', sizeValue: 32, sizeUnit: 'oz', packageType: 'container' },
      { label: '1 gal jug', sizeValue: 1, sizeUnit: 'gal', packageType: 'jug' }
    );
  } else if (normalizedCategory.includes('meat') || normalizedCategory.includes('poultry') || normalizedCategory.includes('chicken') || normalizedCategory.includes('beef')) {
    quickFills.push(
      { label: '1 lb package', sizeValue: 1, sizeUnit: 'lb', packageType: 'package' },
      { label: '2 lb package', sizeValue: 2, sizeUnit: 'lb', packageType: 'package' },
      { label: '5 lb package', sizeValue: 5, sizeUnit: 'lb', packageType: 'package' }
    );
  } else if (normalizedCategory.includes('cereal') || normalizedCategory.includes('cracker')) {
    quickFills.push(
      { label: '10 oz box', sizeValue: 10, sizeUnit: 'oz', packageType: 'box' },
      { label: '14 oz box', sizeValue: 14, sizeUnit: 'oz', packageType: 'box' },
      { label: '18 oz box', sizeValue: 18, sizeUnit: 'oz', packageType: 'box' }
    );
  } else if (normalizedCategory.includes('snack') || normalizedCategory.includes('chip')) {
    quickFills.push(
      { label: '7 oz bag', sizeValue: 7, sizeUnit: 'oz', packageType: 'bag' },
      { label: '10 oz bag', sizeValue: 10, sizeUnit: 'oz', packageType: 'bag' },
      { label: '13 oz bag', sizeValue: 13, sizeUnit: 'oz', packageType: 'bag' }
    );
  } else if (normalizedCategory.includes('condiment') || normalizedCategory.includes('sauce') || normalizedCategory.includes('ketchup')) {
    quickFills.push(
      { label: '12 oz bottle', sizeValue: 12, sizeUnit: 'oz', packageType: 'bottle' },
      { label: '20 oz bottle', sizeValue: 20, sizeUnit: 'oz', packageType: 'bottle' },
      { label: '32 oz bottle', sizeValue: 32, sizeUnit: 'oz', packageType: 'bottle' }
    );
  } else if (normalizedCategory.includes('pantry') || normalizedCategory.includes('rice') || normalizedCategory.includes('flour')) {
    quickFills.push(
      { label: '1 lb bag', sizeValue: 1, sizeUnit: 'lb', packageType: 'bag' },
      { label: '2 lb bag', sizeValue: 2, sizeUnit: 'lb', packageType: 'bag' },
      { label: '5 lb bag', sizeValue: 5, sizeUnit: 'lb', packageType: 'bag' }
    );
  } else if (normalizedCategory.includes('produce')) {
    quickFills.push(
      { label: '1 lb', sizeValue: 1, sizeUnit: 'lb' },
      { label: '2 lb bag', sizeValue: 2, sizeUnit: 'lb', packageType: 'bag' },
      { label: 'bunch', sizeValue: 1, sizeUnit: 'each', packageType: 'bunch' }
    );
  } else if (normalizedCategory.includes('bakery') || normalizedCategory.includes('bread')) {
    quickFills.push(
      { label: '20 oz loaf', sizeValue: 20, sizeUnit: 'oz', packageType: 'loaf' },
      { label: '24 oz loaf', sizeValue: 24, sizeUnit: 'oz', packageType: 'loaf' }
    );
  }
  
  return quickFills;
};

export const ReceiptMappingReview: React.FC<ReceiptMappingReviewProps> = ({ 
  receiptId, 
  onImportComplete 
}) => {
  const [lineItems, setLineItems] = useState<ReceiptLineItem[]>([]);
  const [receiptDetails, setReceiptDetails] = useState<ReceiptImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [showAutoApproved, setShowAutoApproved] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [isNewSupplier, setIsNewSupplier] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const needsAttentionRef = React.useRef<HTMLDivElement>(null);
  
  const { selectedRestaurant } = useRestaurantContext();
  const { getReceiptDetails, getReceiptLineItems, updateLineItemMapping, bulkImportLineItems } = useReceiptImport();
  const { products } = useProducts(selectedRestaurant?.restaurant_id || null);
  const { suppliers, createSupplier } = useSuppliers();
  const { toast } = useToast();

  const isPDF = receiptDetails?.file_name?.toLowerCase().endsWith('.pdf') || false;
  const isImported = receiptDetails?.status === 'imported';

  // Load data
  useEffect(() => {
    loadData();
  }, [receiptId]);

  const loadData = async () => {
    setLoading(true);
    
    if (fileBlobUrl) {
      URL.revokeObjectURL(fileBlobUrl);
      setFileBlobUrl(null);
    }
    
    const [details, items] = await Promise.all([
      getReceiptDetails(receiptId),
      getReceiptLineItems(receiptId)
    ]);
    setReceiptDetails(details);
    setLineItems(items);
    
    // Fetch receipt file with auth
    if (details?.raw_file_url) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.access_token) {
          const response = await fetch(details.raw_file_url, {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          });
          
          if (response.ok) {
            const blob = await response.blob();
            setFileBlobUrl(URL.createObjectURL(blob));
          }
        }
      } catch (error) {
        console.error('Error fetching receipt file:', error);
      }
    }
    
    setLoading(false);
  };

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (fileBlobUrl) URL.revokeObjectURL(fileBlobUrl);
    };
  }, [fileBlobUrl]);

  // Initialize supplier from receipt details
  useEffect(() => {
    if (receiptDetails?.supplier_id && !selectedSupplierId) {
      setSelectedSupplierId(receiptDetails.supplier_id);
      const existingSupplier = suppliers.find(s => s.id === receiptDetails.supplier_id);
      setIsNewSupplier(!existingSupplier);
    }
  }, [receiptDetails?.supplier_id, suppliers, selectedSupplierId]);

  // Computed values
  const tieredItems = useMemo(() => {
    const tiers: Record<ConfidenceTier, ReceiptLineItem[]> = {
      'auto-approved': [],
      'quick-review': [],
      'needs-attention': [],
    };
    
    lineItems.forEach(item => {
      const tier = getItemTier(item);
      tiers[tier].push(item);
    });
    
    return tiers;
  }, [lineItems]);

  const mappedCount = lineItems.filter(item => item.mapping_status === 'mapped').length;
  const newItemsCount = lineItems.filter(item => item.mapping_status === 'new_item').length;
  const pendingCount = lineItems.filter(item => item.mapping_status === 'pending').length;
  const skippedCount = lineItems.filter(item => item.mapping_status === 'skipped').length;
  const readyCount = mappedCount + newItemsCount;

  // Helper to get linked items count
  const getLinkedItemsCount = useCallback((item: ReceiptLineItem) => {
    if (!item.parsed_name) return 0;
    return lineItems.filter(i => 
      i.parsed_name?.toLowerCase().trim() === item.parsed_name?.toLowerCase().trim()
    ).length;
  }, [lineItems]);

  // Handlers
  const handleItemUpdate = async (itemId: string, updates: Record<string, any>) => {
    const success = await updateLineItemMapping(itemId, updates);
    if (success) {
      setLineItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, ...updates } : item
      ));
    }
  };

  const handleMappingChange = (itemId: string, productId: string | null) => {
    const currentItem = lineItems.find(i => i.id === itemId);
    
    if (productId === 'new_item') {
      handleItemUpdate(itemId, { matched_product_id: null, mapping_status: 'new_item' });
    } else if (productId === 'skip') {
      handleItemUpdate(itemId, { matched_product_id: null, mapping_status: 'skipped' });
    } else {
      const matchedProduct = products.find(p => p.id === productId);
      handleItemUpdate(itemId, { 
        matched_product_id: productId, 
        mapping_status: 'mapped',
        parsed_unit: matchedProduct?.uom_purchase || undefined
      });
    }

    // Auto-apply to matching items
    if (currentItem?.parsed_name) {
      const matchingItems = lineItems.filter(item => 
        item.id !== itemId &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === currentItem.parsed_name?.toLowerCase().trim()
      );

      if (matchingItems.length > 0) {
        matchingItems.forEach(item => {
          if (productId === 'new_item') {
            handleItemUpdate(item.id, { matched_product_id: null, mapping_status: 'new_item' });
          } else if (productId === 'skip') {
            handleItemUpdate(item.id, { matched_product_id: null, mapping_status: 'skipped' });
          } else {
            const matchedProduct = products.find(p => p.id === productId);
            handleItemUpdate(item.id, { 
              matched_product_id: productId, 
              mapping_status: 'mapped',
              parsed_unit: matchedProduct?.uom_purchase || undefined
            });
          }
        });

        toast({
          title: "Applied to matching items",
          description: `Also updated ${matchingItems.length} other "${currentItem.parsed_name}" item(s)`,
        });
      }
    }
  };

  const handleQuantityChange = (itemId: string, quantity: number) => {
    handleItemUpdate(itemId, { parsed_quantity: quantity });
  };

  const handlePriceChange = (itemId: string, price: number) => {
    handleItemUpdate(itemId, { parsed_price: price });
  };

  const handleNameChange = (itemId: string, name: string) => {
    handleItemUpdate(itemId, { parsed_name: name });
  };

  const handlePackageTypeChange = (itemId: string, packageType: string) => {
    handleItemUpdate(itemId, { package_type: packageType });
  };

  const handleSizeValueChange = (itemId: string, sizeValue: number) => {
    handleItemUpdate(itemId, { size_value: sizeValue });
  };

  const handleSizeUnitChange = (itemId: string, sizeUnit: string) => {
    handleItemUpdate(itemId, { size_unit: sizeUnit });
  };

  const handleSkuChange = (itemId: string, sku: string) => {
    handleItemUpdate(itemId, { parsed_sku: sku });
    
    if (sku && sku.length >= 3) {
      const matchedProduct = products.find(p => p.sku?.toLowerCase() === sku.toLowerCase());
      if (matchedProduct) {
        handleMappingChange(itemId, matchedProduct.id);
        toast({ title: "Product Matched", description: `Matched to "${matchedProduct.name}" by SKU` });
      }
    }
  };

  const handleApplySuggestion = (item: ReceiptLineItem, field: 'size' | 'package' | 'all') => {
    const updates: Record<string, any> = {};
    
    if ((field === 'size' || field === 'all') && item.suggested_size_value) {
      updates.size_value = item.suggested_size_value;
      if (item.suggested_size_unit) updates.size_unit = item.suggested_size_unit;
    }
    if ((field === 'package' || field === 'all') && item.suggested_package_type) {
      updates.package_type = item.suggested_package_type;
    }

    if (Object.keys(updates).length > 0) {
      handleItemUpdate(item.id, updates);
      toast({ title: "Applied from catalog", description: "Used size/package info from matched product" });
    }
  };

  const handleQuickFill = (itemId: string, quickFill: { sizeValue: number; sizeUnit: string; packageType?: string }) => {
    const updates: Record<string, any> = {
      size_value: quickFill.sizeValue,
      size_unit: quickFill.sizeUnit,
    };
    if (quickFill.packageType) updates.package_type = quickFill.packageType;
    handleItemUpdate(itemId, updates);
  };

  const handleSupplierChange = async (supplierIdOrName: string, isNew: boolean) => {
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      let supplierId: string;
      let supplierName: string;

      if (isNew) {
        const newSupplier = await createSupplier({ name: supplierIdOrName, is_active: true });
        if (!newSupplier) throw new Error('Failed to create supplier');
        
        supplierId = newSupplier.id;
        supplierName = newSupplier.name;
        setIsNewSupplier(true);
        toast({ title: "New Supplier Created", description: `"${supplierName}" has been added` });
      } else {
        const supplier = suppliers.find(s => s.id === supplierIdOrName);
        if (!supplier) throw new Error('Supplier not found');
        
        supplierId = supplier.id;
        supplierName = supplier.name;
        setIsNewSupplier(false);
      }

      const { error } = await supabase
        .from('receipt_imports')
        .update({ vendor_name: supplierName, supplier_id: supplierId })
        .eq('id', receiptId);

      if (error) throw error;

      setReceiptDetails(prev => prev ? { ...prev, vendor_name: supplierName, supplier_id: supplierId } : null);
      setSelectedSupplierId(supplierId);
    } catch (error) {
      console.error('Error updating supplier:', error);
      toast({ title: "Error", description: "Failed to update supplier", variant: "destructive" });
    }
  };

  const handlePurchaseDateChange = async (date: Date | undefined) => {
    if (!date) return;
    
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const dateString = format(date, 'yyyy-MM-dd');
      
      const { error } = await supabase
        .from('receipt_imports')
        .update({ purchase_date: dateString })
        .eq('id', receiptId);

      if (error) throw error;

      setReceiptDetails(prev => prev ? { ...prev, purchase_date: dateString } : null);
      toast({ title: "Purchase Date Updated", description: `Set to ${format(date, 'PPP')}` });
    } catch (error) {
      console.error('Error updating purchase date:', error);
      toast({ title: "Error", description: "Failed to update purchase date", variant: "destructive" });
    }
  };

  const handleBulkImport = async () => {
    setImporting(true);
    const success = await bulkImportLineItems(receiptId);
    if (success) {
      onImportComplete();
    }
    setImporting(false);
  };

  const handleBatchAcceptAll = (itemIds: string[]) => {
    itemIds.forEach(id => {
      const item = lineItems.find(i => i.id === id);
      if (item && item.mapping_status === 'pending') {
        handleItemUpdate(id, { mapping_status: 'new_item' });
      }
    });
  };

  const handleBatchSetPackageType = (itemIds: string[], packageType: string) => {
    itemIds.forEach(id => {
      handleItemUpdate(id, { package_type: packageType });
    });
  };

  // Auto-scroll to needs attention section
  const handleReviewItems = useCallback(() => {
    needsAttentionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Select the first needs-attention item
    const firstNeedsAttention = tieredItems['needs-attention'][0];
    if (firstNeedsAttention) {
      setSelectedItemId(firstNeedsAttention.id);
    }
  }, [tieredItems]);

  if (loading) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-6 w-48" />
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Receipt Image/PDF Column */}
      {receiptDetails?.raw_file_url && (
        <Card className="lg:col-span-1 lg:sticky lg:top-4 lg:h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {isPDF ? <FileText className="h-4 w-4" /> : <Image className="h-4 w-4" />}
              Receipt
            </CardTitle>
          </CardHeader>
          <CardContent>
            {imageError ? (
              <div className="border rounded-lg p-6 text-center space-y-3">
                <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">Unable to display</p>
                {fileBlobUrl && (
                  <a
                    href={fileBlobUrl}
                    download={receiptDetails.file_name || 'receipt'}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-md hover:bg-accent"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                )}
              </div>
            ) : isPDF ? (
              <object
                data={fileBlobUrl || undefined}
                type="application/pdf"
                className="w-full h-[500px] rounded-lg border"
                onError={() => setImageError(true)}
              >
                <div className="border rounded-lg p-6 text-center">
                  <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm">PDF preview not available</p>
                </div>
              </object>
            ) : (
              <img 
                src={fileBlobUrl || undefined} 
                alt="Receipt" 
                className="w-full h-auto rounded-lg border"
                onError={() => setImageError(true)}
              />
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Main Content Column */}
      <Card className={receiptDetails?.raw_file_url ? "lg:col-span-2" : "lg:col-span-3"}>
        {/* Status Bar */}
        <ReceiptStatusBar
          vendorName={receiptDetails?.vendor_name || null}
          purchaseDate={receiptDetails?.purchase_date ? format(new Date(receiptDetails.purchase_date), 'MMM d, yyyy') : null}
          totalAmount={receiptDetails?.total_amount || null}
          readyCount={readyCount}
          needsReviewCount={pendingCount}
          skippedCount={skippedCount}
          totalCount={lineItems.length}
          isImporting={importing}
          isImported={isImported}
          onImport={handleBulkImport}
          showAutoApproved={showAutoApproved}
          onToggleAutoApproved={() => setShowAutoApproved(!showAutoApproved)}
          onReviewItems={handleReviewItems}
        />

        <CardContent className="space-y-6 pt-6">
          {/* Vendor & Date Section */}
          {!isImported && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Vendor</label>
                <SearchableSupplierSelector
                  value={selectedSupplierId || undefined}
                  onValueChange={handleSupplierChange}
                  suppliers={suppliers}
                  placeholder="Select or create supplier..."
                  showNewIndicator={isNewSupplier}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Purchase Date
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !receiptDetails?.purchase_date && "text-muted-foreground"
                      )}
                    >
                      {receiptDetails?.purchase_date 
                        ? format(new Date(receiptDetails.purchase_date), 'PPP')
                        : 'Pick a date'}
                      {receiptDetails?.purchase_date && (
                        <CheckCircle className="ml-auto h-4 w-4 text-green-600" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={receiptDetails?.purchase_date ? new Date(receiptDetails.purchase_date) : undefined}
                      onSelect={handlePurchaseDateChange}
                      disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Batch Actions */}
          <ReceiptBatchActions
            lineItems={lineItems}
            onAcceptAll={handleBatchAcceptAll}
            onSetPackageType={handleBatchSetPackageType}
            isImported={isImported}
          />

          <Separator />

          {/* Needs Attention Section */}
          {tieredItems['needs-attention'].length > 0 && (
            <section ref={needsAttentionRef} className="space-y-3 scroll-mt-24">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold">Needs Attention</h3>
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                  {tieredItems['needs-attention'].length}
                </Badge>
              </div>
              <div className="space-y-2">
                {tieredItems['needs-attention'].map((item, index) => (
                  <ReceiptItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    tier="needs-attention"
                    linkedCount={getLinkedItemsCount(item)}
                    products={products}
                    isImported={isImported}
                    onMappingChange={handleMappingChange}
                    onQuantityChange={handleQuantityChange}
                    onPriceChange={handlePriceChange}
                    onNameChange={handleNameChange}
                    onPackageTypeChange={handlePackageTypeChange}
                    onSizeValueChange={handleSizeValueChange}
                    onSizeUnitChange={handleSizeUnitChange}
                    onSkuChange={handleSkuChange}
                    onApplySuggestion={handleApplySuggestion}
                    onQuickFill={handleQuickFill}
                    categoryQuickFills={getCategoryQuickFills((item as any).parsed_category)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Quick Review Section */}
          {tieredItems['quick-review'].length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-500" />
                <h3 className="font-semibold">Quick Review</h3>
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  {tieredItems['quick-review'].length}
                </Badge>
              </div>
              <div className="space-y-2">
                {tieredItems['quick-review'].map((item, index) => (
                  <ReceiptItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    tier="quick-review"
                    linkedCount={getLinkedItemsCount(item)}
                    products={products}
                    isImported={isImported}
                    onMappingChange={handleMappingChange}
                    onQuantityChange={handleQuantityChange}
                    onPriceChange={handlePriceChange}
                    onNameChange={handleNameChange}
                    onPackageTypeChange={handlePackageTypeChange}
                    onSizeValueChange={handleSizeValueChange}
                    onSizeUnitChange={handleSizeUnitChange}
                    onSkuChange={handleSkuChange}
                    onApplySuggestion={handleApplySuggestion}
                    onQuickFill={handleQuickFill}
                    categoryQuickFills={getCategoryQuickFills((item as any).parsed_category)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Auto-Approved Section (Collapsible) */}
          {tieredItems['auto-approved'].length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setShowAutoApproved(!showAutoApproved)}
                className="flex items-center gap-2 w-full text-left"
                aria-expanded={showAutoApproved}
              >
                <CheckCircle className="h-4 w-4 text-green-500" />
                <h3 className="font-semibold">Ready to Import</h3>
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  {tieredItems['auto-approved'].length}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {showAutoApproved ? 'Hide' : 'Show'}
                </span>
                {showAutoApproved ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              
              {showAutoApproved && (
                <div className="space-y-2">
                  {tieredItems['auto-approved'].map((item, index) => (
                    <ReceiptItemRow
                      key={item.id}
                      item={item}
                      index={index}
                      tier="auto-approved"
                      linkedCount={getLinkedItemsCount(item)}
                      products={products}
                      isImported={isImported}
                      onMappingChange={handleMappingChange}
                      onQuantityChange={handleQuantityChange}
                      onPriceChange={handlePriceChange}
                      onNameChange={handleNameChange}
                      onPackageTypeChange={handlePackageTypeChange}
                      onSizeValueChange={handleSizeValueChange}
                      onSizeUnitChange={handleSizeUnitChange}
                      onSkuChange={handleSkuChange}
                      onApplySuggestion={handleApplySuggestion}
                      onQuickFill={handleQuickFill}
                      categoryQuickFills={getCategoryQuickFills((item as any).parsed_category)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Empty state */}
          {lineItems.length === 0 && (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No items found in this receipt</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
