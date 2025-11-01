import { useState, useMemo } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface CategorySelectorProps {
  restaurantId: string;
  value?: string;
  onSelect: (accountId: string) => void;
  onAddNew?: () => void;
}

export function CategorySelector({ restaurantId, value, onSelect, onAddNew }: CategorySelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['chart-of-accounts', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('account_type')
        .order('account_code');

      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId,
  });

  const selectedAccount = accounts?.find(acc => acc.id === value);

  const organizedAccounts = useMemo(() => {
    if (!accounts) return {};
    
    // Separate parents and subs
    const parents = accounts.filter(acc => !acc.parent_account_id);
    const subsMap = accounts.reduce((map, acc) => {
      if (acc.parent_account_id) {
        if (!map[acc.parent_account_id]) map[acc.parent_account_id] = [];
        map[acc.parent_account_id].push(acc);
      }
      return map;
    }, {} as Record<string, typeof accounts>);
    
    // Group parents by type
    const grouped = parents.reduce((acc, account) => {
      if (!acc[account.account_type]) acc[account.account_type] = [];
      acc[account.account_type].push({ 
        account, 
        subAccounts: subsMap[account.id] || [] 
      });
      return acc;
    }, {} as Record<string, Array<{ account: any; subAccounts: any[] }>>);
    
    return grouped;
  }, [accounts]);

  const typeLabels: Record<string, string> = {
    asset: 'Asset Accounts',
    liability: 'Liability Accounts',
    equity: 'Equity Accounts',
    revenue: 'Revenue Accounts',
    expense: 'Expense Accounts',
    cogs: 'Cost of Goods Sold',
  };

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return organizedAccounts;
    
    const query = searchQuery.toLowerCase();
    const filtered: typeof organizedAccounts = {};
    
    Object.entries(organizedAccounts).forEach(([type, items]) => {
      const matches = items.map(({ account, subAccounts }) => {
        const parentMatches = 
          account.account_name.toLowerCase().includes(query) ||
          account.account_code.toLowerCase().includes(query);
        
        const matchingSubAccounts = subAccounts.filter((sub: any) =>
          sub.account_name.toLowerCase().includes(query) ||
          sub.account_code.toLowerCase().includes(query) ||
          account.account_name.toLowerCase().includes(query)
        );
        
        if (parentMatches || matchingSubAccounts.length > 0) {
          return {
            account,
            subAccounts: parentMatches ? subAccounts : matchingSubAccounts
          };
        }
        return null;
      }).filter(Boolean);
      
      if (matches.length > 0) {
        filtered[type] = matches as any;
      }
    });
    
    return filtered;
  }, [organizedAccounts, searchQuery]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between text-left"
        >
          {selectedAccount ? (
            <span className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-mono text-xs text-muted-foreground flex-shrink-0">{selectedAccount.account_code}</span>
              <span className="truncate">{selectedAccount.account_name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select category...</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              placeholder="Search categories..."
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <CommandList className="max-h-[400px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : Object.keys(filteredGroups).length === 0 ? (
              <CommandEmpty>No categories found.</CommandEmpty>
            ) : (
              <>
                {Object.entries(filteredGroups).map(([type, items], idx) => (
                  <div key={type}>
                    {idx > 0 && <CommandSeparator />}
                    <CommandGroup heading={typeLabels[type] || type}>
                      {items.map(({ account, subAccounts }: any) => (
                        <div key={account.id}>
                          {/* Parent Account */}
                          <CommandItem
                            value={account.id}
                            onSelect={() => {
                              onSelect(account.id);
                              setOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                value === account.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <div className="flex items-center gap-2 flex-1">
                              <span className="font-mono text-xs text-muted-foreground">
                                {account.account_code}
                              </span>
                              <span>{account.account_name}</span>
                            </div>
                          </CommandItem>
                          
                          {/* Sub-Accounts */}
                          {subAccounts.map((subAccount: any) => (
                            <CommandItem
                              key={subAccount.id}
                              value={subAccount.id}
                              onSelect={() => {
                                onSelect(subAccount.id);
                                setOpen(false);
                              }}
                              className="cursor-pointer ml-4"
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  value === subAccount.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <span className="text-muted-foreground mr-2">↳</span>
                              <div className="flex items-center gap-2 flex-1">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {subAccount.account_code}
                                </span>
                                <span className="text-sm">{subAccount.account_name}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </div>
                      ))}
                    </CommandGroup>
                  </div>
                ))}
              </>
            )}
          </CommandList>
          {onAddNew && (
            <>
              <CommandSeparator />
              <div className="p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onAddNew();
                    setOpen(false);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add new category
                </Button>
              </div>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}