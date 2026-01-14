import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SearchableProductSelector } from '@/components/SearchableProductSelector';
import { 
  CheckCircle, AlertCircle, Plus, ChevronDown, ChevronRight, 
  Package, Sparkles, Barcode, Link2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReceiptLineItem } from '@/hooks/useReceiptImport';
import { WEIGHT_UNITS, VOLUME_UNITS } from '@/lib/enhancedUnitConversion';
import { PACKAGE_TYPE_OPTIONS } from '@/lib/packageTypes';
import { GroupedUnitSelector } from '@/components/GroupedUnitSelector';

type ConfidenceTier = 'auto-approved' | 'quick-review' | 'needs-attention';

interface ReceiptItemRowProps {
  item: ReceiptLineItem;
  index: number;
  tier: ConfidenceTier;
  linkedCount: number;
  products: any[];
  isImported: boolean;
  onMappingChange: (itemId: string, productId: string | null) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onPriceChange: (itemId: string, price: number) => void;
  onNameChange: (itemId: string, name: string) => void;
  onPackageTypeChange: (itemId: string, packageType: string) => void;
  onSizeValueChange: (itemId: string, sizeValue: number) => void;
  onSizeUnitChange: (itemId: string, sizeUnit: string) => void;
  onSkuChange: (itemId: string, sku: string) => void;
  onApplySuggestion: (item: ReceiptLineItem, field: 'size' | 'package' | 'all') => void;
  onQuickFill: (itemId: string, quickFill: { sizeValue: number; sizeUnit: string; packageType?: string }) => void;
  categoryQuickFills: { label: string; sizeValue: number; sizeUnit: string; packageType?: string }[];
}

export const ReceiptItemRow: React.FC<ReceiptItemRowProps> = ({
  item,
  index,
  tier,
  linkedCount,
  products,
  isImported,
  onMappingChange,
  onQuantityChange,
  onPriceChange,
  onNameChange,
  onPackageTypeChange,
  onSizeValueChange,
  onSizeUnitChange,
  onSkuChange,
  onApplySuggestion,
  onQuickFill,
  categoryQuickFills,
}) => {
  // Auto-approved items start collapsed, others start expanded
  const [isOpen, setIsOpen] = useState(tier !== 'auto-approved');

  const hasSuggestions = !!(item.suggested_size_value || item.suggested_package_type);
  const needsSizeInfo = !item.size_value && !item.size_unit && tier !== 'auto-approved';
  const matchedProduct = products.find(p => p.id === item.matched_product_id);

  // Intent-based labels instead of raw confidence %
  const getIntentLabel = (item: ReceiptLineItem) => {
    // Already resolved
    if (item.mapping_status === 'mapped') {
      return <Badge variant="secondary" className="text-xs bg-green-50 text-green-700 border-green-200">Looks correct</Badge>;
    }
    if (item.mapping_status === 'skipped') {
      return <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">Skipped</Badge>;
    }
    if (item.mapping_status === 'new_item' && (item.confidence_score || 0) >= 0.8) {
      return <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700 border-blue-200">New item</Badge>;
    }
    
    // Needs attention indicators
    if (!item.matched_product_id && item.mapping_status === 'pending') {
      if ((item.confidence_score || 0) < 0.5) {
        return <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-200">No match found</Badge>;
      }
      return <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Check mapping</Badge>;
    }
    
    // Size/unit issues
    if (!item.size_value && !item.size_unit) {
      return <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Add size info</Badge>;
    }
    
    // Price anomaly (simple heuristic - if price seems unusual)
    if (item.parsed_price && item.parsed_price > 100) {
      return <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Check price</Badge>;
    }
    
    return null;
  };

  const formatPrice = (price: number | null) => {
    if (!price) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(price);
  };

  const getStatusIcon = () => {
    switch (item.mapping_status) {
      case 'mapped':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'new_item':
        return <Plus className="h-4 w-4 text-blue-600" />;
      case 'skipped':
        return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/50" />;
      default:
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
    }
  };

  const getTierStyles = () => {
    switch (tier) {
      case 'auto-approved':
        return 'bg-muted/30 hover:bg-muted/50';
      case 'quick-review':
        return 'bg-background border-l-2 border-l-amber-400';
      case 'needs-attention':
        return 'bg-amber-50 dark:bg-amber-900/10 border-l-4 border-l-amber-500';
      default:
        return '';
    }
  };

  // Compact row for auto-approved items
  if (tier === 'auto-approved' && !isOpen) {
    return (
      <div 
        className={cn(
          "flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-colors",
          getTierStyles()
        )}
        onClick={() => setIsOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsOpen(true)}
        aria-expanded={false}
        aria-label={`${item.parsed_name || item.raw_text}, ${formatPrice(item.parsed_price)}, click to expand`}
      >
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <span className="font-medium">{item.parsed_name || item.raw_text}</span>
          {matchedProduct && (
            <span className="text-sm text-muted-foreground">→ {matchedProduct.name}</span>
          )}
          {linkedCount > 1 && (
            <Badge variant="outline" className="text-xs">
              <Link2 className="h-3 w-3 mr-1" />
              {linkedCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          {item.size_value && item.size_unit && (
            <Badge variant="secondary" className="font-normal">
              {item.size_value} {item.size_unit}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {item.parsed_quantity || 1} × {formatPrice((item.parsed_price || 0) / (item.parsed_quantity || 1))}
          </span>
          <span className="font-medium">{formatPrice(item.parsed_price)}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn("rounded-lg border transition-all", getTierStyles())}>
        {/* Collapsible Header */}
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              {getStatusIcon()}
              <span className="font-medium">{item.parsed_name || item.raw_text}</span>
              {linkedCount > 1 && (
                <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-900/20 border-blue-200">
                  <Link2 className="h-3 w-3 mr-1" />
                  {linkedCount} linked
                </Badge>
              )}
              {/* Intent-based status instead of raw confidence % */}
              {getIntentLabel(item)}
            </div>
            <div className="flex items-center gap-4">
              <span className="font-medium">{formatPrice(item.parsed_price)}</span>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-2 space-y-4 border-t">
            {/* Quick actions for items with suggestions */}
            {hasSuggestions && !item.size_value && (
              <div className="flex items-center gap-2 p-2 bg-primary/5 rounded-md">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">From catalog:</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onApplySuggestion(item, 'all')}
                  className="h-7 text-xs"
                >
                  Apply {item.suggested_size_value} {item.suggested_size_unit} {item.suggested_package_type}
                </Button>
              </div>
            )}

            {/* Quick fill pills for items needing size info */}
            {needsSizeInfo && categoryQuickFills.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Quick fill:</span>
                <div className="flex flex-wrap gap-1.5">
                  {categoryQuickFills.slice(0, 5).map((qf, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      onClick={() => onQuickFill(item.id, qf)}
                      className="h-7 text-xs hover:bg-primary/10 hover:border-primary/50"
                    >
                      {qf.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column: Item details */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`name-${item.id}`} className="text-xs text-muted-foreground">
                      Item Name
                    </Label>
                    <Input
                      id={`name-${item.id}`}
                      defaultValue={item.parsed_name || ''}
                      onChange={(e) => onNameChange(item.id, e.target.value)}
                      placeholder="Item name"
                      disabled={isImported}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`sku-${item.id}`} className="text-xs text-muted-foreground flex items-center gap-1">
                      <Barcode className="h-3 w-3" />
                      SKU / Barcode
                    </Label>
                    <Input
                      id={`sku-${item.id}`}
                      defaultValue={item.parsed_sku || ''}
                      onChange={(e) => onSkuChange(item.id, e.target.value)}
                      placeholder="Scan or type"
                      disabled={isImported}
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label htmlFor={`qty-${item.id}`} className="text-xs text-muted-foreground">
                      Qty
                    </Label>
                    <Input
                      id={`qty-${item.id}`}
                      type="number"
                      defaultValue={item.parsed_quantity ?? ''}
                      onChange={(e) => onQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                      placeholder="1"
                      disabled={isImported}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`price-${item.id}`} className="text-xs text-muted-foreground">
                      Total Price
                    </Label>
                    <Input
                      id={`price-${item.id}`}
                      type="number"
                      step="0.01"
                      defaultValue={item.parsed_price ?? ''}
                      onChange={(e) => onPriceChange(item.id, parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      disabled={isImported}
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    {item.parsed_quantity && item.parsed_price && (
                      <Badge variant="secondary" className="text-xs">
                        ${((item.parsed_price || 0) / (item.parsed_quantity || 1)).toFixed(2)}/ea
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Size & Package - only show when needed or expanded */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label htmlFor={`size-${item.id}`} className="text-xs text-muted-foreground">
                      Size
                    </Label>
                    <Input
                      id={`size-${item.id}`}
                      type="number"
                      defaultValue={item.size_value ?? ''}
                      onChange={(e) => onSizeValueChange(item.id, parseFloat(e.target.value) || 0)}
                      placeholder="750"
                      disabled={isImported}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`unit-${item.id}`} className="text-xs text-muted-foreground">
                      Unit
                    </Label>
                    <GroupedUnitSelector
                      value={item.size_unit || undefined}
                      onValueChange={(value) => onSizeUnitChange(item.id, value)}
                      placeholder="Unit"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`pkg-${item.id}`} className="text-xs text-muted-foreground">
                      Package
                    </Label>
                    <Select
                      value={item.package_type || item.parsed_unit || ''}
                      onValueChange={(value) => onPackageTypeChange(item.id, value)}
                      disabled={isImported}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[200px]">
                        {PACKAGE_TYPE_OPTIONS.map((group) => (
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

                {/* Package Definition - matches inventory details format */}
                {item.size_value && item.size_unit && (item.package_type || item.parsed_unit) && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-md">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 bg-green-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">✓</span>
                      </div>
                      <span className="text-sm font-semibold text-green-800 dark:text-green-200">Your Package Definition:</span>
                    </div>
                    <div className="text-base font-medium text-green-800 dark:text-green-200 pl-7">
                      1 {item.package_type || item.parsed_unit || 'unit'} containing{' '}
                      <span className="bg-green-200 dark:bg-green-800 px-2 py-0.5 rounded">{item.size_value} {item.size_unit}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: Product mapping */}
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Map to Inventory
                  </Label>
                  {isImported ? (
                    <div className="p-2 bg-muted rounded-md text-sm mt-1">
                      {item.mapping_status === 'new_item' ? (
                        <span className="text-blue-600">Created as new product</span>
                      ) : item.mapping_status === 'mapped' && matchedProduct ? (
                        <span>{matchedProduct.name}</span>
                      ) : (
                        <span className="text-muted-foreground">Skipped</span>
                      )}
                    </div>
                  ) : (
                    <SearchableProductSelector
                      value={
                        item.mapping_status === 'new_item' ? 'new_item' :
                        item.mapping_status === 'skipped' ? 'skip' :
                        item.matched_product_id
                      }
                      onValueChange={(value) => onMappingChange(item.id, value)}
                      products={products}
                      searchTerm={item.parsed_name || item.raw_text}
                      placeholder="Search or create new..."
                    />
                  )}
                </div>

                {/* New item preview */}
                {item.mapping_status === 'new_item' && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2 text-sm">
                      <Plus className="h-4 w-4 text-blue-600" />
                      <span className="text-blue-700 dark:text-blue-300">
                        Will create: <strong>{item.parsed_name || 'Unnamed item'}</strong>
                      </span>
                    </div>
                    {item.size_value && item.size_unit && (
                      <div className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                        with size: {item.size_value} {item.size_unit} per {item.package_type || 'unit'}
                      </div>
                    )}
                  </div>
                )}

                {/* Raw text reference */}
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Raw: </span>
                  "{item.raw_text}"
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
