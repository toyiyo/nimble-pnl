import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableProductSelector } from '@/components/SearchableProductSelector';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useReceiptImport, ReceiptLineItem } from '@/hooks/useReceiptImport';
import { useProducts } from '@/hooks/useProducts';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { CheckCircle, AlertCircle, Package, Plus, ShoppingCart } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface ReceiptMappingReviewProps {
  receiptId: string;
  onImportComplete: () => void;
}

export const ReceiptMappingReview: React.FC<ReceiptMappingReviewProps> = ({ 
  receiptId, 
  onImportComplete 
}) => {
  const [lineItems, setLineItems] = useState<ReceiptLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  const { getReceiptLineItems, updateLineItemMapping, bulkImportLineItems } = useReceiptImport();
  const { products } = useProducts(selectedRestaurant?.id || null);
  const { toast } = useToast();

  useEffect(() => {
    loadLineItems();
  }, [receiptId]);

  const loadLineItems = async () => {
    setLoading(true);
    const items = await getReceiptLineItems(receiptId);
    setLineItems(items);
    setLoading(false);
  };

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
      handleItemUpdate(itemId, { 
        matched_product_id: productId, 
        mapping_status: 'mapped' 
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
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Review & Map Receipt Items
        </CardTitle>
        <CardDescription>
          Review the extracted items and map them to your existing inventory or create new items
        </CardDescription>
        
        {/* Summary stats */}
        <div className="flex gap-4 pt-2">
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
      </CardHeader>
      <CardContent className="space-y-4">
        {lineItems.map((item, index) => (
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
                    id={`name-${item.id}`}
                    value={item.parsed_name || ''}
                    onChange={(e) => handleNameChange(item.id, e.target.value)}
                    placeholder="Enter item name"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`quantity-${item.id}`}>Quantity</Label>
                    <Input
                      id={`quantity-${item.id}`}
                      type="number"
                      value={item.parsed_quantity || ''}
                      onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`unit-${item.id}`}>Unit</Label>
                    <Input
                      id={`unit-${item.id}`}
                      value={item.parsed_unit || ''}
                      onChange={(e) => handleUnitChange(item.id, e.target.value)}
                      placeholder="lb, gal, each"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor={`price-${item.id}`}>Price</Label>
                  <Input
                    id={`price-${item.id}`}
                    type="number"
                    step="0.01"
                    value={item.parsed_price || ''}
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
        ))}

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
  );
};