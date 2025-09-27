import React, { useState, useEffect, useMemo } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, Package, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

interface Product {
  id: string;
  name: string;
  sku: string;
  current_stock: number;
  uom_purchase: string | null;
  receipt_item_names: string[];
  similarity_score?: number;
  match_type?: string;
}

interface SearchableProductSelectorProps {
  value?: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchTerm?: string;
  disabled?: boolean;
}

export const SearchableProductSelector: React.FC<SearchableProductSelectorProps> = ({
  value,
  onValueChange,
  placeholder = "Search for existing product...",
  searchTerm = "",
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(searchTerm);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();

  // Auto-search products when search term changes
  useEffect(() => {
    if (searchTerm && searchTerm.length > 2) {
      setSearchValue(searchTerm);
      searchProducts(searchTerm);
    }
  }, [searchTerm]);

  const searchProducts = async (term: string) => {
    if (!selectedRestaurant?.restaurant_id || term.length < 2) {
      setProducts([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('advanced_product_search', {
        p_restaurant_id: selectedRestaurant.restaurant_id,
        p_search_term: term,
        p_similarity_threshold: 0.25,
        p_limit: 15
      });

      if (error) {
        console.error('Error searching products:', error);
        setProducts([]);
      } else {
        // Convert the advanced search results to our Product interface
        const mappedProducts = (data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          current_stock: item.current_stock,
          uom_purchase: item.uom_purchase,
          receipt_item_names: item.receipt_item_names || [],
          similarity_score: item.combined_score,
          match_type: item.match_type
        }));
        setProducts(mappedProducts);
      }
    } catch (error) {
      console.error('Error searching products:', error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = useMemo(() => {
    return products.find(product => product.id === value);
  }, [products, value]);

  const handleSearch = (term: string) => {
    setSearchValue(term);
    if (term.length >= 2) {
      searchProducts(term);
    } else {
      setProducts([]);
    }
  };

  const handleSelect = (productId: string) => {
    onValueChange(productId === value ? null : productId);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled}
          >
            {selectedProduct ? (
              <div className="flex items-center gap-2 truncate">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{selectedProduct.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {selectedProduct.sku}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground truncate">
                {placeholder}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Type to search products..."
              value={searchValue}
              onValueChange={handleSearch}
            />
            <CommandList>
              <CommandEmpty>
                {loading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
                    Searching...
                  </div>
                ) : searchValue.length < 2 ? (
                  "Type at least 2 characters to search..."
                ) : (
                  <div className="py-4 text-center">
                    <div className="text-sm text-muted-foreground mb-2">
                      No products found for "{searchValue}"
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onValueChange('new_item');
                        setOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Create New Item
                    </Button>
                  </div>
                )}
              </CommandEmpty>
              <CommandGroup>
                {products.map((product) => (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onSelect={handleSelect}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Check
                        className={cn(
                          "h-4 w-4",
                          value === product.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{product.name}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <span>{product.sku}</span>
                          <span>•</span>
                          <span>{product.current_stock} {product.uom_purchase || 'units'}</span>
                          {product.similarity_score && (
                            <>
                              <span>•</span>
                              <span className={`font-medium ${
                                product.similarity_score > 0.8 ? 'text-green-600' :
                                product.similarity_score > 0.5 ? 'text-yellow-600' : 'text-orange-600'
                              }`}>
                                {Math.round(product.similarity_score * 100)}% match
                              </span>
                            </>
                          )}
                        </div>
                        {product.receipt_item_names && product.receipt_item_names.length > 0 && (
                          <div className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                            <span>Previously mapped:</span>
                            <span className="font-medium">
                              {product.receipt_item_names.slice(0, 2).join(', ')}
                              {product.receipt_item_names.length > 2 && ` +${product.receipt_item_names.length - 2} more`}
                            </span>
                            {product.match_type === 'receipt_exact' && (
                              <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                                Exact Match
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected product info */}
      {selectedProduct && (
        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded border border-green-200 dark:border-green-800">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium text-green-700 dark:text-green-300">
                Will update: {selectedProduct.name}
              </div>
              <div className="text-green-600 dark:text-green-400">
                Current stock: {selectedProduct.current_stock} {selectedProduct.uom_purchase || 'units'}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onValueChange(null)}
              className="text-green-700 hover:text-green-900 dark:text-green-300 dark:hover:text-green-100"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Special actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onValueChange('new_item')}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create New Item
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onValueChange('skip')}
          className="flex items-center gap-2"
        >
          <X className="h-4 w-4" />
          Skip Item
        </Button>
      </div>
    </div>
  );
};