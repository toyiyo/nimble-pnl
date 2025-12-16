import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { TransactionFilters } from '@/types/transactions';
export type { TransactionFilters } from '@/types/transactions';

interface TransactionFiltersProps {
  restaurantId: string;
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
}

export const TransactionFiltersSheet = ({ restaurantId, filters, onFiltersChange }: TransactionFiltersProps) => {
  const [localFilters, setLocalFilters] = useState<TransactionFilters>(filters);
  const [open, setOpen] = useState(false);

  // Fetch bank accounts for filter
  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('connected_banks')
        .select('id, institution_name, bank_account_balances!inner(id, account_name, account_mask, is_active)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'connected')
        .eq('bank_account_balances.is_active', true);
      
      if (error) throw error;
      
      // Filter out banks with no active balance records
      return data?.filter(bank => bank.bank_account_balances && bank.bank_account_balances.length > 0) || [];
    },
    enabled: !!restaurantId && open,
  });

  const handleApply = () => {
    onFiltersChange(localFilters);
    setOpen(false);
  };

  const handleReset = () => {
    const emptyFilters: TransactionFilters = {};
    setLocalFilters(emptyFilters);
    onFiltersChange(emptyFilters);
  };

  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Filter className="h-4 w-4" />
          Filter
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 w-5 rounded-full p-0 flex items-center justify-center">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Filter Transactions</SheetTitle>
          <SheetDescription>
            Apply filters to narrow down your transaction list
          </SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 mt-6 pb-4">
            {/* Basic Filters Section */}
            <div className="space-y-4">
              {/* Date Range */}
              <div className="space-y-2">
                <Label>Date Range <span className="text-xs text-muted-foreground">(Optional)</span></Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input
                      type="date"
                      value={localFilters.dateFrom || ''}
                      onChange={(e) => setLocalFilters({ ...localFilters, dateFrom: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      value={localFilters.dateTo || ''}
                      onChange={(e) => setLocalFilters({ ...localFilters, dateTo: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Amount Range */}
              <div className="space-y-2">
                <Label>Amount Range <span className="text-xs text-muted-foreground">(Optional)</span></Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Min</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={localFilters.minAmount || ''}
                      onChange={(e) => setLocalFilters({ ...localFilters, minAmount: parseFloat(e.target.value) || undefined })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Max</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={localFilters.maxAmount || ''}
                      onChange={(e) => setLocalFilters({ ...localFilters, maxAmount: parseFloat(e.target.value) || undefined })}
                    />
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Transaction Filters Section */}
            <div className="space-y-4">
              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={localFilters.status || 'all'}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, status: value === 'all' ? undefined : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="posted">Posted</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Transaction Type */}
              <div className="space-y-2">
                <Label>Transaction Type</Label>
                <Select
                  value={localFilters.transactionType || 'all'}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, transactionType: value === 'all' ? undefined : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="debit">Debits (Expenses)</SelectItem>
                    <SelectItem value="credit">Credits (Income)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bank Account Filter */}
              <div className="space-y-2">
                <Label>Bank Account</Label>
                <Select
                  value={localFilters.bankAccountId || 'all'}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, bankAccountId: value === 'all' ? undefined : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {bankAccounts?.map((bank) => 
                      bank.bank_account_balances?.map((account: any) => (
                        <SelectItem key={account.id} value={account.id}>
                          {bank.institution_name} {account.account_mask ? `••••${account.account_mask}` : ''}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Category Filters Section */}
            <div className="space-y-4">
              {/* Category Filter */}
              <div className="space-y-2">
                <Label>Category</Label>
                <SearchableAccountSelector
                  value={localFilters.categoryId}
                  onValueChange={(categoryId) => setLocalFilters({ ...localFilters, categoryId })}
                  placeholder="Select category..."
                />
                {localFilters.categoryId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLocalFilters({ ...localFilters, categoryId: undefined })}
                  >
                    Clear category
                  </Button>
                )}
              </div>

              {/* Uncategorized Filter */}
              <div className="space-y-2">
                <Label>Show Only</Label>
                <Select
                  value={localFilters.showUncategorized === true ? 'uncategorized' : 'all'}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, showUncategorized: value === 'uncategorized' ? true : undefined })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All transactions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All transactions</SelectItem>
                    <SelectItem value="uncategorized">Uncategorized only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Sticky Footer with Actions */}
        <div className="border-t pt-4 mt-auto space-y-2">
          <Button onClick={handleApply} className="w-full" size="lg">
            Apply Filters
          </Button>
          <Button onClick={handleReset} variant="outline" className="w-full">
            Clear All Filters
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
