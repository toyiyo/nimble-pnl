import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Fuse from 'fuse.js';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Supplier } from '@/hooks/useSuppliers';

interface SearchableSupplierSelectorProps {
  value?: string;
  onValueChange: (value: string, isNew: boolean) => void;
  suppliers: Supplier[];
  disabled?: boolean;
  placeholder?: string;
  showNewIndicator?: boolean;
}

export function SearchableSupplierSelector({
  value,
  onValueChange,
  suppliers,
  disabled = false,
  placeholder = "Search suppliers...",
  showNewIndicator = false,
}: SearchableSupplierSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  
  // Fuzzy search implementation with Fuse.js
  const fuse = useMemo(() => {
    return new Fuse(suppliers, {
      keys: ['name'],
      threshold: 0.4,
      includeScore: true,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }, [suppliers]);
  
  // Show all suppliers if no search, otherwise use fuzzy search
  const filteredSuppliers = useMemo(() => {
    if (!searchValue) return suppliers;
    
    const results = fuse.search(searchValue);
    return results.map(result => result.item);
  }, [searchValue, fuse, suppliers]);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === value);
  
  // Handle display for special values
  const getDisplayValue = () => {
    if (value === 'new_supplier') {
      return searchValue || '+ Create New Supplier';
    }
    if (selectedSupplier) return selectedSupplier.name;
    return placeholder;
  };

  const handleSelect = (supplierId: string) => {
    if (supplierId === 'new_supplier') {
      onValueChange(searchValue, true);
      setOpen(false);
      return;
    }
    
    onValueChange(supplierId, false);
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
            value === 'new_supplier' && "text-blue-600 font-medium"
          )}>
            {getDisplayValue()}
            {showNewIndicator && value === 'new_supplier' && (
              <span className="ml-2 text-xs text-muted-foreground">(new)</span>
            )}
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
          <CommandList 
            className="max-h-72 overflow-y-auto overscroll-contain"
            style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
          >
            <CommandEmpty>
              <div className="py-6 text-center text-sm">
                <p className="text-muted-foreground">No suppliers found</p>
              </div>
            </CommandEmpty>
            
            {/* Special actions group */}
            {searchValue && (
              <CommandGroup heading="Actions">
                <CommandItem
                  value="new_supplier"
                  onSelect={() => handleSelect('new_supplier')}
                  className="cursor-pointer font-medium text-blue-600"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 flex-shrink-0",
                      value === 'new_supplier' ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span>+ Create New Supplier: "{searchValue}"</span>
                </CommandItem>
              </CommandGroup>
            )}
            
            {/* Existing suppliers group */}
            {filteredSuppliers.length > 0 && (
              <CommandGroup heading="Existing Suppliers">
                {filteredSuppliers.map((supplier) => (
                  <CommandItem
                    key={supplier.id}
                    value={supplier.id}
                    onSelect={() => handleSelect(supplier.id)}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 flex-shrink-0",
                        value === supplier.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-medium truncate">{supplier.name}</span>
                      {supplier.contact_email && (
                        <span className="text-xs text-muted-foreground truncate">
                          {supplier.contact_email}
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
