import { useState } from "react";
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
}

export function SearchableAccountSelector({
  value,
  onValueChange,
  placeholder = "Select account",
}: SearchableAccountSelectorProps) {
  const [open, setOpen] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || '');

  const selectedAccount = accounts?.find((account) => account.id === value);

  // Group accounts by type
  const groupedAccounts = accounts?.reduce((acc, account) => {
    const type = account.account_type;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(account);
    return acc;
  }, {} as Record<string, typeof accounts>);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedAccount ? (
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
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            {groupedAccounts &&
              Object.entries(groupedAccounts).map(([type, typeAccounts]) => (
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
