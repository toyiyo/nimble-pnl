import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { SearchableProductSelector } from '@/components/SearchableProductSelector';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useReceiptImport, ReceiptLineItem, ReceiptImport } from '@/hooks/useReceiptImport';
import { useProducts } from '@/hooks/useProducts';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { CheckCircle, AlertCircle, Package, Plus, ShoppingCart, Filter, Image, FileText, Download } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { getUnitOptions } from '@/lib/validUnits';

interface ReceiptMappingReviewProps {
  receiptId: string;
  onImportComplete: () => void;
}

type FilterType = 'all' | 'mapped' | 'new_item' | 'pending';

export const ReceiptMappingReview: React.FC<ReceiptMappingReviewProps> = ({ 
  receiptId, 
  onImportComplete 
}) => {
  const [lineItems, setLineItems] = useState<ReceiptLineItem[]>([]);
  const [receiptDetails, setReceiptDetails] = useState<ReceiptImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [imageError, setImageError] = useState(false);
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const { selectedRestaurant } = useRestaurantContext();
  const { getReceiptDetails, getReceiptLineItems, updateLineItemMapping, bulkImportLineItems } = useReceiptImport();
  const { products } = useProducts(selectedRestaurant?.id || null);
  const { toast } = useToast();

  // Detect file type based on extension
  const isPDF = receiptDetails?.file_name?.toLowerCase().endsWith('.pdf') || false;

  useEffect(() => {
    loadData();
  }, [receiptId]);

  const loadData = async () => {
    setLoading(true);
    
    // Clean up previous blob URL if exists
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
    
    // Fetch the receipt file with auth headers and create a blob URL
    if (details?.raw_file_url) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.access_token) {
          const response = await fetch(details.raw_file_url, {
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
          });
          
          if (response.ok) {
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            setFileBlobUrl(blobUrl);
          }
        }
      } catch (error) {
        console.error('Error fetching receipt file:', error);
      }
    }
    
    setLoading(false);
  };

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (fileBlobUrl) {
        URL.revokeObjectURL(fileBlobUrl);
      }
    };
  }, [fileBlobUrl]);

  const handleItemUpdate = async (itemId: string, updates: any) => {
    const success = await updateLineItemMapping(itemId, updates);
    if (success) {
      setLineItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, ...updates } : item
      ));
    }
  };

  const handleMappingChange = (itemId: string, productId: string | null) => {
    if (productId === 'new_item') {
      handleItemUpdate(itemId, { 
        matched_product_id: null, 
        mapping_status: 'new_item' 
      });
    } else if (productId === 'skip') {
      handleItemUpdate(itemId, { 
        matched_product_id: null, 
        mapping_status: 'skipped' 
      });
    } else {
      const matchedProduct = products.find(p => p.id === productId);
      handleItemUpdate(itemId, { 
        matched_product_id: productId, 
        mapping_status: 'mapped',
        parsed_unit: matchedProduct?.uom_purchase || undefined
      });
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

  const handleUnitChange = (itemId: string, unit: string) => {
    handleItemUpdate(itemId, { parsed_unit: unit });
  };

  const handleBulkImport = async () => {
    setImporting(true);
    const success = await bulkImportLineItems(receiptId);
    if (success) {
      onImportComplete();
    }
    setImporting(false);
  };

  const getStatusBadge = (item: ReceiptLineItem) => {
    switch (item.mapping_status) {
      case 'mapped':
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Mapped</Badge>;
      case 'new_item':
        return <Badge variant="secondary"><Plus className="w-3 h-3 mr-1" />New Item</Badge>;
      case 'skipped':
        return <Badge variant="outline">Skipped</Badge>;
      default:
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Needs Review</Badge>;
    }
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (!confidence) return 'text-gray-400';
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const mappedCount = lineItems.filter(item => item.mapping_status === 'mapped').length;
  const newItemsCount = lineItems.filter(item => item.mapping_status === 'new_item').length;
  const pendingCount = lineItems.filter(item => item.mapping_status === 'pending').length;

  const filteredItems = lineItems.filter(item => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'pending') return item.mapping_status === 'pending';
    return item.mapping_status === activeFilter;
  });

  const getFilterButtonVariant = (filter: FilterType) => {
    return activeFilter === filter ? 'default' : 'outline';
  };

  if (loading) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
            Loading receipt items...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Receipt Image/PDF */}
      {receiptDetails?.raw_file_url && (
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isPDF ? <FileText className="h-4 w-4" /> : <Image className="h-4 w-4" />}
              Original Receipt
            </CardTitle>
            {receiptDetails.file_name && (
              <CardDescription className="text-xs">{receiptDetails.file_name}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {imageError ? (
              <div className="border rounded-lg p-8 text-center space-y-4">
                <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground" />
                <div>
                  <p className="font-medium">Unable to display receipt</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    The receipt file could not be loaded.
                  </p>
                </div>
                {fileBlobUrl ? (
                  <a
                    href={fileBlobUrl}
                    download={receiptDetails.file_name || 'receipt'}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-sm font-medium"
                  >
                    <Download className="h-4 w-4" />
                    Download Receipt
                  </a>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download Receipt
                  </Button>
                )}
              </div>
            ) : isPDF ? (
              <div className="space-y-2">
                <object
                  data={fileBlobUrl || undefined}
                  type="application/pdf"
                  className="w-full h-[600px] rounded-lg border shadow-sm"
                  onError={() => setImageError(true)}
                >
                  <div className="border rounded-lg p-8 text-center space-y-4">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
                    <div>
                      <p className="font-medium">PDF Preview Not Available</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Your browser doesn't support PDF preview.
                      </p>
                    </div>
                    {fileBlobUrl && (
                      <a
                        href={fileBlobUrl}
                        download={receiptDetails.file_name || 'receipt.pdf'}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-sm font-medium"
                      >
                        <Download className="h-4 w-4" />
                        Download PDF
                      </a>
                    )}
                  </div>
                </object>
                {fileBlobUrl && (
                  <div className="flex justify-center">
                    <a
                      href={fileBlobUrl}
                      download={receiptDetails.file_name || 'receipt.pdf'}
                      className="inline-flex items-center gap-2 px-4 py-2 hover:bg-accent hover:text-accent-foreground rounded-md text-sm"
                    >
                      <Download className="h-4 w-4" />
                      Download PDF
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <img 
                src={fileBlobUrl || undefined} 
                alt="Receipt" 
                className="w-full h-auto rounded-lg border shadow-sm"
                onError={() => setImageError(true)}
              />
            )}
            {!imageError && (
              <div className="mt-4 space-y-1">
                {receiptDetails.vendor_name && (
                  <p className="text-sm text-muted-foreground">
                    Vendor: {receiptDetails.vendor_name}
                  </p>
                )}
                {receiptDetails.total_amount && (
                  <p className="text-sm text-muted-foreground">
                    Total: ${receiptDetails.total_amount.toFixed(2)}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Receipt Items */}
      <Card className={receiptDetails?.raw_file_url ? "lg:col-span-2" : "lg:col-span-3"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Review & Map Receipt Items
          </CardTitle>
          <CardDescription>
            Review the extracted items and map them to your existing inventory or create new items
          </CardDescription>
          
          {/* Summary stats and filters */}
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <div className="flex gap-4">
              <div className="text-sm">
                <span className="font-medium text-green-600">{mappedCount}</span> mapped
              </div>
              <div className="text-sm">
                <span className="font-medium text-blue-600">{newItemsCount}</span> new items
              </div>
              <div className="text-sm">
                <span className="font-medium text-red-600">{pendingCount}</span> need review
              </div>
            </div>
            
            {/* Filter buttons */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={getFilterButtonVariant('all')}
                size="sm"
                onClick={() => setActiveFilter('all')}
                className="flex items-center gap-1"
              >
                <Filter className="w-3 h-3" />
                All ({lineItems.length})
              </Button>
              <Button
                variant={getFilterButtonVariant('mapped')}
                size="sm"
                onClick={() => setActiveFilter('mapped')}
                className="flex items-center gap-1"
              >
                <CheckCircle className="w-3 h-3" />
                Mapped ({mappedCount})
              </Button>
              <Button
                variant={getFilterButtonVariant('new_item')}
                size="sm"
                onClick={() => setActiveFilter('new_item')}
                className="flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                New ({newItemsCount})
              </Button>
              <Button
                variant={getFilterButtonVariant('pending')}
                size="sm"
                onClick={() => setActiveFilter('pending')}
                className="flex items-center gap-1"
              >
                <AlertCircle className="w-3 h-3" />
                Review ({pendingCount})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No items match the current filter.
          </div>
        ) : (
          filteredItems.map((item, index) => (
          <div key={item.id} className="border rounded-lg p-4 space-y-4">
            {/* Header with status and confidence */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Item {index + 1}</span>
                {getStatusBadge(item)}
                {item.confidence_score && (
                  <span className={`text-xs ${getConfidenceColor(item.confidence_score)}`}>
                    {Math.round(item.confidence_score * 100)}% confidence
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                Raw: "{item.raw_text}"
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column: Item details */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor={`name-${item.id}`}>Item Name</Label>
                  <Input
                    key={`name-${item.id}`}
                    id={`name-${item.id}`}
                    defaultValue={item.parsed_name || ''}
                    onChange={(e) => handleNameChange(item.id, e.target.value)}
                    placeholder="Enter item name"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`quantity-${item.id}`}>Quantity</Label>
                    <Input
                      key={`quantity-${item.id}`}
                      id={`quantity-${item.id}`}
                      type="number"
                      defaultValue={item.parsed_quantity || ''}
                      onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`unit-${item.id}`}>Unit</Label>
                    <Select
                      value={item.parsed_unit || ''}
                      onValueChange={(value) => handleUnitChange(item.id, value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {getUnitOptions().map((group) => (
                          <SelectGroup key={group.label}>
                            <SelectLabel>{group.label}</SelectLabel>
                            {group.options.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor={`price-${item.id}`}>Price</Label>
                  <Input
                    key={`price-${item.id}`}
                    id={`price-${item.id}`}
                    type="number"
                    step="0.01"
                    defaultValue={item.parsed_price || ''}
                    onChange={(e) => handlePriceChange(item.id, parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Right column: Mapping */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor={`mapping-${item.id}`}>Map to Inventory</Label>
                  <SearchableProductSelector
                    value={
                      item.mapping_status === 'new_item' ? 'new_item' :
                      item.mapping_status === 'skipped' ? 'skip' :
                      item.matched_product_id
                    }
                    onValueChange={(value) => handleMappingChange(item.id, value)}
                    searchTerm={item.parsed_name || item.raw_text}
                    placeholder="Search existing products or create new..."
                  />
                </div>


                {/* Show new item info */}
                {item.mapping_status === 'new_item' && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800">
                    <div className="text-sm">
                      <div className="font-medium text-blue-700 dark:text-blue-300">
                        Will create new product:
                      </div>
                      <div className="text-blue-600 dark:text-blue-400">
                        {item.parsed_name || 'Unnamed item'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
          ))
        )}

        {/* Import button */}
        <div className="flex justify-end pt-4">
          <Button
            onClick={handleBulkImport}
            disabled={importing || pendingCount > 0}
            className="flex items-center gap-2"
            size="lg"
          >
            <ShoppingCart className="w-4 h-4" />
            {importing ? 'Importing...' : `Import ${mappedCount + newItemsCount} Items`}
          </Button>
        </div>

        {pendingCount > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
              <AlertCircle className="w-4 h-4" />
              <span className="font-medium">
                {pendingCount} items need review before importing
              </span>
            </div>
          </div>
        )}
        </CardContent>
      </Card>
    </div>
  );
};