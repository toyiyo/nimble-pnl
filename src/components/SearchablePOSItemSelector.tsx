import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
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
import { useInsideScrollLock } from "@/components/ui/scroll-lock-boundary";
import { POSItem } from "@/hooks/usePOSItems";

interface SearchablePOSItemSelectorProps {
  value?: string;
  onValueChange: (value: string, itemId?: string) => void;
  posItems: POSItem[];
  loading?: boolean;
  disabled?: boolean;
  onSearchChange?: (search: string) => void;
  error?: unknown;
  onRetry?: () => void;
}

export function SearchablePOSItemSelector({
  value,
  onValueChange,
  posItems,
  loading = false,
  disabled = false,
  onSearchChange,
  error,
  onRetry,
}: SearchablePOSItemSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const handleSearchChange = (search: string) => {
    setSearchValue(search);
    onSearchChange?.(search);
  };

  const selectedItem = posItems.find((item) => item.item_name === value);

  /** Clearing the visible input is not enough: the search is served by the
   * server-side RPC, so the *owner's* term has to be reset too or the next
   * open still shows the previous query's narrowed list. */
  const resetSearch = () => {
    setSearchValue('');
    onSearchChange?.('');
  };

  const handleSelect = (itemName: string) => {
    const item = posItems.find((i) => i.item_name === itemName);
    onValueChange(itemName, item?.item_id);
    setOpen(false);
    resetSearch();
  };

  const handleClear = () => {
    onValueChange('', '');
    setOpen(false);
    resetSearch();
  };

  const modal = useInsideScrollLock();

  /** A selection can outlive the item's presence in the current search page,
   * so fall back to the raw `value` rather than rendering the placeholder. */
  const triggerLabel = loading
    ? "Loading POS items..."
    : value
      ? (selectedItem?.item_name ?? value)
      : "Search POS items or leave blank";

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled || loading}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full sm:w-[400px] p-0 bg-background border shadow-md z-50" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search POS items..."
            value={searchValue}
            onValueChange={handleSearchChange}
          />
          <CommandList className="max-h-72 overflow-y-auto">
            {/* Branch on the data, not on cmdk's `CommandEmpty`: with
                `shouldFilter={false}` cmdk's empty-state counts *registered*
                items, and the "Clear selection" row below is registered
                whenever a value is set -- so `CommandEmpty` would never fire
                on the edit-an-existing-recipe path, silently swallowing both
                the failure and the no-matches message. */}
            {posItems.length === 0 && (
              error ? (
                <div className="py-6 text-center text-sm space-y-2">
                  <p className="text-muted-foreground">
                    Couldn't load POS items. Something went wrong.
                  </p>
                  {onRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onRetry}
                    >
                      Try again
                    </Button>
                  )}
                </div>
              ) : (
                <div className="py-6 text-center text-sm">
                  <p className="text-muted-foreground">No POS items found</p>
                </div>
              )
            )}
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={handleClear}
                  className="text-muted-foreground cursor-pointer"
                >
                  Clear selection
                </CommandItem>
              )}
              {posItems.map((item) => (
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
