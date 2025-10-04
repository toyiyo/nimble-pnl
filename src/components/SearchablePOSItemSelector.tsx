import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
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
import { POSItem } from '@/hooks/usePOSItems';

interface SearchablePOSItemSelectorProps {
  value?: string;
  onValueChange: (value: string, itemId?: string) => void;
  posItems: POSItem[];
  loading?: boolean;
  disabled?: boolean;
}

export function SearchablePOSItemSelector({
  value,
  onValueChange,
  posItems,
  loading = false,
  disabled = false,
}: SearchablePOSItemSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  
  // Show all items if no search, otherwise filter
  const filteredItems = searchValue
    ? posItems.filter((item) =>
        item.item_name.toLowerCase().includes(searchValue.toLowerCase())
      )
    : posItems;

  const selectedItem = posItems.find((item) => item.item_name === value);

  const handleSelect = (itemName: string) => {
    const item = posItems.find((i) => i.item_name === itemName);
    onValueChange(itemName, item?.item_id);
    setOpen(false);
    setSearchValue('');
  };

  const handleClear = () => {
    onValueChange('', '');
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
          disabled={disabled || loading}
        >
          <span className="truncate">
            {loading ? (
              "Loading POS items..."
            ) : selectedItem ? (
              selectedItem.item_name
            ) : (
              "Search POS items or leave blank"
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full sm:w-[400px] h-[400px] p-0 bg-background border shadow-md z-50 flex flex-col" align="start">
        <Command shouldFilter={false} className="flex-1 flex flex-col">
          <CommandInput
            placeholder="Search POS items..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className="flex-1 overflow-auto">
            <CommandEmpty>
              <div className="py-6 text-center text-sm">
                <p className="text-muted-foreground">No POS items found</p>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={handleClear}
                  className="text-muted-foreground cursor-pointer"
                >
                  Clear selection
                </CommandItem>
              )}
              {filteredItems.map((item) => (
                <CommandItem
                  key={item.item_name}
                  value={item.item_name}
                  onSelect={() => handleSelect(item.item_name)}
                  className="cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 flex-shrink-0",
                      value === item.item_name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium truncate">{item.item_name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {item.sales_count} sales • {item.source === 'pos_sales' ? 'POS' : 'Unified'}
                      {item.last_sold && ` • Last: ${item.last_sold}`}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
