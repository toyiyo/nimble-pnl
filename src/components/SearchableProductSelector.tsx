import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Product } from '@/hooks/useProducts';

interface SearchableProductSelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  products: Product[];
  disabled?: boolean;
  placeholder?: string;
  searchTerm?: string;
}

export function SearchableProductSelector({
  value,
  onValueChange,
  products,
  disabled = false,
  placeholder = "Search products...",
  searchTerm = "",
}: SearchableProductSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(searchTerm);
  
  // Show all products if no search, otherwise filter
  const filteredProducts = searchValue
    ? products.filter((product) =>
        product.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        product.sku?.toLowerCase().includes(searchValue.toLowerCase()) ||
        product.brand?.toLowerCase().includes(searchValue.toLowerCase())
      )
    : products;

  const selectedProduct = products.find((product) => product.id === value);
  
  // Handle display for special values
  const getDisplayValue = () => {
    if (value === 'new_item') return '+ Create New Item';
    if (value === 'skip') return 'Skip This Item';
    if (selectedProduct) return selectedProduct.name;
    return placeholder;
  };

  const handleSelect = (productId: string) => {
    onValueChange(productId);
    setOpen(false);
    setSearchValue('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          <span className={cn(
            "truncate",
            value === 'new_item' && "text-blue-600 font-medium",
            value === 'skip' && "text-muted-foreground"
          )}>
            {getDisplayValue()}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full sm:w-[400px] p-0 bg-background border shadow-md z-50" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className="max-h-[300px] overflow-y-auto">
            <CommandEmpty>
              <div className="py-6 text-center text-sm">
                <p className="text-muted-foreground">No products found</p>
              </div>
            </CommandEmpty>
            
            {/* Special actions group */}
            <CommandGroup heading="Actions">
              <CommandItem
                value="new_item"
                onSelect={() => handleSelect('new_item')}
                className="cursor-pointer font-medium text-blue-600"
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 flex-shrink-0",
                    value === 'new_item' ? "opacity-100" : "opacity-0"
                  )}
                />
                <span>+ Create New Item</span>
              </CommandItem>
              <CommandItem
                value="skip"
                onSelect={() => handleSelect('skip')}
                className="cursor-pointer text-muted-foreground"
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 flex-shrink-0",
                    value === 'skip' ? "opacity-100" : "opacity-0"
                  )}
                />
                <span>Skip This Item</span>
              </CommandItem>
            </CommandGroup>
            
            {/* Existing products group */}
            {filteredProducts.length > 0 && (
              <CommandGroup heading="Existing Products">
                {filteredProducts.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id}
                  onSelect={() => handleSelect(product.id)}
                  className="cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 flex-shrink-0",
                      value === product.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium truncate">{product.name}</span>
                    {product.cost_per_unit && (
                      <span className="text-xs text-muted-foreground truncate">
                        ${product.cost_per_unit.toFixed(2)}/{product.uom_purchase || 'unit'}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
