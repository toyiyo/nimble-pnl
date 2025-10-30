import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

interface SearchableAccountSelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  filterByTypes?: string[];
}

export function SearchableAccountSelector({
  value,
  onValueChange,
  placeholder = "Select account",
  disabled = false,
  filterByTypes,
}: SearchableAccountSelectorProps) {
  const [open, setOpen] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  const { accounts, loading } = useChartOfAccounts(selectedRestaurant?.restaurant_id || '');

  const selectedAccount = useMemo(
    () => accounts?.find((account) => account.id === value),
    [accounts, value]
  );

  // Filter accounts by type if specified
  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    if (!filterByTypes || filterByTypes.length === 0) return accounts;
    return accounts.filter(acc => filterByTypes.includes(acc.account_type));
  }, [accounts, filterByTypes]);

  // Group accounts by type with useMemo for better performance
  const groupedAccounts = useMemo(() => {
    if (!filteredAccounts) return {};
    
    return filteredAccounts.reduce((acc, account) => {
      const type = account.account_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(account);
      return acc;
    }, {} as Record<string, typeof filteredAccounts>);
  }, [filteredAccounts]);

  const isEmpty = !loading && filteredAccounts.length === 0;
  const isDisabled = disabled || loading;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-busy={loading}
          className="w-full justify-between"
          disabled={isDisabled}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Loading accounts...
            </span>
          ) : selectedAccount ? (
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {selectedAccount.account_code}
              </span>
              {selectedAccount.account_name}
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0 bg-background z-50" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList 
            className="max-h-72 overflow-y-auto overscroll-contain pointer-events-auto"
            style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin' } as React.CSSProperties}
          >
            {isEmpty ? (
              <div className="py-6 px-4 text-center text-sm text-muted-foreground">
                <p className="font-medium mb-1">No accounts found</p>
                <p className="text-xs">Create accounts in Chart of Accounts to get started</p>
              </div>
            ) : (
              <>
                <CommandEmpty>No account found.</CommandEmpty>
                {Object.entries(groupedAccounts).map(([type, typeAccounts]) => (
                  <CommandGroup key={type} heading={type}>
                    {typeAccounts.map((account) => (
                      <CommandItem
                        key={account.id}
                        value={`${account.account_code} ${account.account_name}`}
                        onSelect={() => {
                          onValueChange(account.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === account.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground w-16">
                            {account.account_code}
                          </span>
                          <span>{account.account_name}</span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
