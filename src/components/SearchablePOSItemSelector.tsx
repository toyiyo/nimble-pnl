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
  onValueChange: (value: string, itemId?: string | null) => void;
  posItems: POSItem[];
  loading?: boolean;
  disabled?: boolean;
  onSearchChange?: (search: string) => void;
  error?: unknown;
  onRetry?: () => void;
  /** Injected by shadcn's `FormControl` via Radix `Slot` when this selector is
   * used inside a `FormField`. They have to reach the `<button
   * role="combobox">` itself: `FormLabel` renders `htmlFor={formItemId}`, and
   * the root of this component is a `<Popover>` -- not a DOM node -- so
   * without an explicit hand-off the label associates with nothing and the
   * field is unlabelled for screen readers. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
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
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SearchablePOSItemSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const handleSearchChange = (search: string) => {
    setSearchValue(search);
    onSearchChange?.(search);
  };

  const selectedItem = posItems.find((item) => item.item_name === value);

  /** The search term's lifetime is the popover's. Clearing the visible input
   * is not enough: the search is served by the server-side RPC, so the
   * *owner's* term has to be reset too (via `handleSearchChange('')`) or the
   * next open still shows the previous query's narrowed list. Resetting here
   * rather than in `handleSelect`/`handleClear` also covers dismissal without
   * a selection -- Escape, or a click outside. */
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) handleSearchChange('');
  };

  const handleSelect = (itemName: string) => {
    const item = posItems.find((i) => i.item_name === itemName);
    onValueChange(itemName, item?.item_id);
    handleOpenChange(false);
  };

  const handleClear = () => {
    onValueChange('', '');
    handleOpenChange(false);
  };

  const modal = useInsideScrollLock();

  /** A selection can outlive the item's presence in the current search page,
   * so fall back to the raw `value` rather than rendering the placeholder. */
  let triggerLabel = "Search POS items or leave blank";
  if (loading) {
    triggerLabel = "Loading POS items...";
  } else if (value) {
    triggerLabel = selectedItem?.item_name ?? value;
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
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
