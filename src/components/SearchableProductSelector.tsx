import React, { useState, useEffect, useMemo } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, Package, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { SupplierBadge } from '@/components/SupplierBadge';
import Fuse from 'fuse.js';

interface Product {
  id: string;
  name: string;
  sku: string;
  brand?: string;
  category?: string;
  current_stock: number;
  uom_purchase: string | null;
  receipt_item_names: string[];
  similarity_score?: number;
  match_type?: string;
  supplier?: {
    id: string;
    name: string;
    contact_email: string | null;
    contact_phone: string | null;
    address: string | null;
    website: string | null;
    is_active: boolean;
  } | null;
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
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();

  // Enhanced search utilities
  const normalizeSearchTerm = (term: string) => {
    return term
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  };

  // Enhanced word-based search that handles partial matches better
  const wordBasedSearch = (products: Product[], searchTerm: string) => {
    if (!searchTerm.trim()) return [];
    
    const searchWords = normalizeSearchTerm(searchTerm).split(' ').filter(word => word.length >= 2);
    
    return products.filter(product => {
      const searchableText = [
        product.name,
        product.brand,
        product.category,
        product.sku,
        ...(product.receipt_item_names || [])
      ].filter(Boolean).join(' ').toLowerCase();
      
      // Match if ANY search word is found
      return searchWords.some(word => searchableText.includes(word));
    }).map(product => ({
      ...product,
      similarity_score: calculateMatchScore(product, searchTerm) / 100,
      match_type: 'word_match'
    }));
  };

  const calculateMatchScore = (product: Product, searchTerm: string) => {
    let score = 0;
    const normalizedSearch = normalizeSearchTerm(searchTerm);
    const normalizedName = normalizeSearchTerm(product.name);
    const normalizedBrand = normalizeSearchTerm(product.brand || '');
    const normalizedSku = normalizeSearchTerm(product.sku);
    
    // Exact match gets highest score
    if (normalizedName.includes(normalizedSearch)) score += 100;
    if (normalizedBrand.includes(normalizedSearch)) score += 80;
    if (normalizedSku.includes(normalizedSearch)) score += 60;
    
    // Word matches get partial scores - more generous scoring
    const searchWords = normalizedSearch.split(' ').filter(word => word.length >= 2);
    searchWords.forEach(word => {
      if (normalizedName.includes(word)) score += word.length >= 4 ? 40 : 25;
      if (normalizedBrand.includes(word)) score += 20;
      if (normalizedSku.includes(word)) score += 15;
      
      // Check receipt item names for previous mappings
      product.receipt_item_names?.forEach(receiptName => {
        if (normalizeSearchTerm(receiptName).includes(word)) score += 30;
      });
    });
    
    return score;
  };

  const fuseOptions = {
    keys: [
      { name: 'name', weight: 0.6 },
      { name: 'brand', weight: 0.2 },
      { name: 'sku', weight: 0.1 },
      { name: 'receipt_item_names', weight: 0.1 }
    ],
    threshold: 0.3, // More lenient for better matches
    includeScore: true,
    minMatchCharLength: 2,
    ignoreLocation: true,
    findAllMatches: true,
    shouldSort: true
  };

  // Load all products initially and auto-search when search term changes
  useEffect(() => {
    if (selectedRestaurant?.restaurant_id) {
      loadAllProducts();
    }
  }, [selectedRestaurant]);

  useEffect(() => {
    if (searchTerm && searchTerm.length > 2) {
      setSearchValue(searchTerm);
      searchProducts(searchTerm);
    }
  }, [searchTerm]);

  const loadAllProducts = async () => {
    if (!selectedRestaurant?.restaurant_id) {
      setAllProducts([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          name,
          sku,
          brand,
          category,
          current_stock,
          uom_purchase,
          receipt_item_names,
          suppliers (
            id,
            name,
            contact_email,
            contact_phone,
            address,
            website,
            is_active
          )
        `)
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('name');

      if (error) {
        console.error('Error loading products:', error);
        setAllProducts([]);
      } else {
        const mappedProducts = (data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          brand: item.brand,
          category: item.category,
          current_stock: item.current_stock,
          uom_purchase: item.uom_purchase,
          receipt_item_names: item.receipt_item_names || [],
          supplier: item.suppliers
        }));
        setAllProducts(mappedProducts);
      }
    } catch (error) {
      console.error('Error loading products:', error);
      setAllProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const searchProducts = async (term: string) => {
    if (!selectedRestaurant?.restaurant_id || term.length < 2) {
      setProducts([]);
      return;
    }

    setLoading(true);
    try {
      let searchResults: Product[] = [];

      // Start with PostgreSQL full-text search for best results
      try {
        const { data: ftResults, error: ftError } = await supabase.rpc('fulltext_product_search', {
          p_restaurant_id: selectedRestaurant.restaurant_id,
          p_search_term: term,
          p_limit: 15
        });

        if (!ftError && ftResults?.length > 0) {
          const ftMapped = ftResults.map((item: any) => ({
            id: item.id,
            name: item.name,
            sku: item.sku,
            brand: item.brand,
            category: item.category,
            current_stock: item.current_stock,
            uom_purchase: item.uom_purchase,
            receipt_item_names: item.receipt_item_names || [],
            similarity_score: item.similarity_score,
            match_type: item.match_type
          }));
          searchResults = [...ftMapped];
        }
      } catch (ftError) {
        console.error('Full-text search error:', ftError);
      }

      // Enhance with client-side fuzzy search if needed
      if (searchResults.length < 10 && allProducts.length > 0) {
        const clientResults = wordBasedSearch(allProducts, term)
          .filter(product => !searchResults.some(sr => sr.id === product.id))
          .slice(0, 10);
        searchResults = [...searchResults, ...clientResults];
      }

      // Final fuzzy search enhancement
      if (searchResults.length < 15 && allProducts.length > 0) {
        const fuse = new Fuse(allProducts, fuseOptions);
        const fuzzyResults = fuse.search(term);
        
        const fuzzyMapped = fuzzyResults
          .filter(result => !searchResults.some(sr => sr.id === result.item.id))
          .map(result => ({
            ...result.item,
            similarity_score: 1 - (result.score || 0),
            match_type: 'fuzzy_match'
          }))
          .slice(0, 5);

        searchResults = [...searchResults, ...fuzzyMapped];
      }

      // Sort by similarity score and limit results
      searchResults.sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
      setProducts(searchResults.slice(0, 25));
      
    } catch (error) {
      console.error('Error searching products:', error);
      
      // Fallback to client-side search only
      if (allProducts.length > 0) {
        const clientResults = wordBasedSearch(allProducts, term);
        setProducts(clientResults.slice(0, 15));
      } else {
        setProducts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = useMemo(() => {
    return products.find(product => product.id === value) || 
           allProducts.find(product => product.id === value);
  }, [products, allProducts, value]);

  const displayProducts = useMemo(() => {
    if (showAllProducts || (!searchValue || searchValue.length < 2)) {
      return allProducts.slice(0, 50); // Limit to first 50 for performance
    }
    return products;
  }, [showAllProducts, searchValue, allProducts, products]);

  const handleSearch = (term: string) => {
    setSearchValue(term);
    setShowAllProducts(false);
    if (term.length >= 2) {
      searchProducts(term);
    } else {
      setProducts([]);
      setShowAllProducts(true);
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
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder="Type to search products..."
              value={searchValue}
              onValueChange={handleSearch}
              className="flex-1"
            />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAllProducts(!showAllProducts);
                  setSearchValue('');
                  setProducts([]);
                }}
                className="ml-2 text-xs"
              >
                {showAllProducts ? 'Search' : 'Browse All'}
              </Button>
            </div>
            <CommandList>
              <CommandEmpty>
                {loading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
                    {showAllProducts ? 'Loading products...' : 'Searching...'}
                  </div>
                ) : showAllProducts ? (
                  <div className="py-4 text-center">
                    <div className="text-sm text-muted-foreground mb-2">
                      No products found in your inventory
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
                ) : searchValue.length < 2 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    Type at least 2 characters to search or click "Browse All"
                  </div>
                ) : displayProducts.length === 0 ? (
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
                ) : null}
              </CommandEmpty>
              <CommandGroup>
                {displayProducts.map((product) => (
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
                        <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span>{product.sku}</span>
                          {product.brand && (
                            <>
                              <span>•</span>
                              <span className="text-blue-600">{product.brand}</span>
                            </>
                          )}
                          {product.category && (
                            <>
                              <span>•</span>
                              <span className="text-purple-600">{product.category}</span>
                            </>
                          )}
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
                              {product.match_type && (
                                <Badge variant="outline" className="text-xs ml-1">
                                  {product.match_type === 'fuzzy_match' ? 'Fuzzy' :
                                   product.match_type === 'word_match' ? 'Word' :
                                   product.match_type === 'receipt_exact' ? 'Receipt' :
                                   product.match_type}
                                </Badge>
                              )}
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
              {selectedProduct.supplier && (
                <div className="mt-1">
                  <SupplierBadge supplier={selectedProduct.supplier} />
                </div>
              )}
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