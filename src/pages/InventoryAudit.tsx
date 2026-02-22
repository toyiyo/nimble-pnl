import { useState, useMemo, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { Package, Info, X, ArrowUpDown } from 'lucide-react';

import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useInventoryTransactions } from '@/hooks/useInventoryTransactions';
import { useToast } from '@/hooks/use-toast';

import {
  getDefaultStartDate,
  getDefaultEndDate,
  getDatePresetRange,
  computeAuditDisplayValues,
  countActiveFilters,
  type DatePreset,
  type AuditDisplayValues,
} from '@/lib/inventoryAuditUtils';
import { MemoizedAuditTransactionRow } from '@/components/inventory/MemoizedAuditTransactionRow';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { ExportDropdown } from '@/components/financial-statements/shared/ExportDropdown';
import { generateTablePDF } from '@/utils/pdfExport';
import { formatDateInTimezone } from '@/lib/timezone';

const TRANSACTION_TYPES = [
  {
    value: 'all',
    label: 'All Types',
    description: 'All inventory transactions',
    tooltip: 'Shows all types of inventory movements',
  },
  {
    value: 'purchase',
    label: 'Purchases',
    description: 'Inventory added to stock',
    tooltip: 'Items purchased and added to your inventory. Amount represents the cost you paid for these items.',
  },
  {
    value: 'usage',
    label: 'Cost of Goods Used',
    description: 'Inventory cost consumed',
    tooltip: 'The cost of inventory that was used or sold. This is NOT the retail price charged to customers, but rather the cost of ingredients/products deducted from inventory.',
  },
  {
    value: 'adjustment',
    label: 'Adjustments',
    description: 'Manual inventory corrections',
    tooltip: 'Manual corrections to inventory levels (e.g., corrections from reconciliations, found items, or count adjustments).',
  },
  {
    value: 'waste',
    label: 'Waste',
    description: 'Spoilage & disposal value',
    tooltip: 'Value of inventory lost due to spoilage, damage, or disposal. Represents the cost of wasted items.',
  },
  {
    value: 'transfer',
    label: 'Transfers',
    description: 'Items moved between locations',
    tooltip: 'Inventory transferred between different storage locations or restaurants.',
  },
];

export default function InventoryAudit() {
  const { user } = useAuth();
  const { selectedRestaurant, restaurants, setSelectedRestaurant, loading: restaurantLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState(getDefaultStartDate);
  const [endDate, setEndDate] = useState(getDefaultEndDate);
  const [sortBy, setSortBy] = useState<'date' | 'product' | 'quantity' | 'cost' | 'type'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const { transactions, loading, error, summary, exportToCSV: exportTransactionsToCSV } = useInventoryTransactions({
    restaurantId: selectedRestaurant?.restaurant_id || null,
    typeFilter,
    startDate,
    endDate,
  });

  const filteredTransactions = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const filtered = transactions.filter(txn =>
      txn.product_name.toLowerCase().includes(term) ||
      (txn.reason || '').toLowerCase().includes(term) ||
      (txn.reference_id || '').toLowerCase().includes(term)
    );

    function getDate(txn: typeof transactions[number]): number {
      return new Date(txn.transaction_date || txn.created_at).getTime();
    }

    function dateTiebreaker(a: typeof transactions[number], b: typeof transactions[number]): number {
      return getDate(b) - getDate(a);
    }

    return filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = getDate(a) - getDate(b);
          if (comparison === 0) comparison = a.id.localeCompare(b.id);
          break;
        case 'product':
          comparison = a.product_name.localeCompare(b.product_name) || dateTiebreaker(a, b);
          break;
        case 'quantity':
          comparison = (Math.abs(a.quantity) - Math.abs(b.quantity)) || dateTiebreaker(a, b);
          break;
        case 'cost':
          comparison = (Math.abs(a.total_cost || 0) - Math.abs(b.total_cost || 0)) || dateTiebreaker(a, b);
          break;
        case 'type':
          comparison = a.transaction_type.localeCompare(b.transaction_type) || dateTiebreaker(a, b);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [transactions, searchTerm, sortBy, sortDirection]);

  const activeFiltersCount = countActiveFilters({ typeFilter, searchTerm, startDate, endDate });

  const clearFilters = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setStartDate(getDefaultStartDate());
    setEndDate(getDefaultEndDate());
    setSortBy('date');
    setSortDirection('desc');
  };

  const activeDatePreset = useMemo((): DatePreset | null => {
    for (const preset of ['7d', '14d', '30d', 'mtd'] as DatePreset[]) {
      const range = getDatePresetRange(preset);
      if (range.startDate === startDate && range.endDate === endDate) return preset;
    }
    return null;
  }, [startDate, endDate]);

  const displayValuesMap = useMemo(() => {
    const map = new Map<string, AuditDisplayValues>();
    const tz = selectedRestaurant?.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const txn of filteredTransactions) {
      map.set(txn.id, computeAuditDisplayValues(txn, tz));
    }
    return map;
  }, [filteredTransactions, selectedRestaurant?.restaurant.timezone]);

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredTransactions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  function hasInvalidDateRange(): boolean {
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      toast({
        title: 'Invalid date range',
        description: 'Start date must be before end date.',
        variant: 'destructive',
      });
      return true;
    }
    return false;
  }

  function getDateRangeLabel(): string {
    if (startDate && endDate) return `${startDate} to ${endDate}`;
    if (startDate) return `From ${startDate}`;
    if (endDate) return `To ${endDate}`;
    return 'All Time';
  }

  const handleExportCSV = async () => {
    if (hasInvalidDateRange()) return;

    setIsExporting(true);
    try {
      await exportTransactionsToCSV();
      toast({
        title: 'Export Successful',
        description: 'Inventory audit data exported to CSV',
      });
    } catch (exportError) {
      if (import.meta.env.DEV) {
        console.error('Error exporting CSV:', exportError);
      }
      toast({
        title: 'Export Failed',
        description: 'Failed to export audit data',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (hasInvalidDateRange()) return;

    setIsExporting(true);
    try {
      const tz = selectedRestaurant?.restaurant.timezone || 'UTC';
      const columns = ['Date', 'Product', 'Type', 'Quantity', 'Unit Cost', 'Total Cost', 'Reason'];
      const rows = filteredTransactions.map((txn) => [
        formatDateInTimezone(txn.transaction_date || txn.created_at, tz, 'MMM dd, yyyy'),
        txn.product_name,
        txn.transaction_type.charAt(0).toUpperCase() + txn.transaction_type.slice(1),
        txn.quantity.toFixed(2),
        `$${(txn.unit_cost || 0).toFixed(2)}`,
        `$${(txn.total_cost || 0).toFixed(2)}`,
        txn.reason || '-',
      ]);

      const filterLabel = typeFilter !== 'all'
        ? ` - ${TRANSACTION_TYPES.find(t => t.value === typeFilter)?.label || 'Filtered'}`
        : '';

      generateTablePDF({
        title: `Inventory Audit Trail${filterLabel}`,
        restaurantName: selectedRestaurant?.restaurant.name || '',
        dateRange: getDateRangeLabel(),
        columns,
        rows,
        filename: `inventory_audit_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`,
      });

      toast({
        title: 'Export Successful',
        description: 'Inventory audit report exported to PDF',
      });
    } catch (exportError) {
      console.error('Error exporting PDF:', exportError);
      toast({
        title: 'Export Failed',
        description: 'Failed to export audit report',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!user) {
    return (
      <div className="w-full px-4 py-8 text-center">
        <p>Please log in to access inventory audit.</p>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="w-full px-4 py-8">
        <div className="rounded-xl border border-border/40 bg-background">
          <div className="py-12">
            <div className="text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-[17px] font-semibold text-foreground">Select a Restaurant</h2>
              <p className="text-[13px] text-muted-foreground">Choose a restaurant to view inventory audit trail.</p>
              <RestaurantSelector
                restaurants={restaurants}
                selectedRestaurant={selectedRestaurant}
                onSelectRestaurant={setSelectedRestaurant}
                loading={restaurantLoading}
                canCreateRestaurant={canCreateRestaurant}
                createRestaurant={createRestaurant}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-8">
      <div className="mb-6">
        <h1 className="text-[17px] font-semibold text-foreground">Inventory Audit Trail</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Track all inventory changes including automatic deductions from POS sales, manual adjustments, and purchases.
        </p>
      </div>

      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-foreground">Filters</h2>
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear {activeFiltersCount} {activeFiltersCount === 1 ? 'filter' : 'filters'}
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="search-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Search</label>
          <Input
            id="search-input"
            placeholder="Products, reasons..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 max-w-sm text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            aria-label="Search transactions by product, reason, or reference"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
          <div className="flex flex-wrap gap-1.5">
            {TRANSACTION_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => setTypeFilter(type.value)}
                className={`h-7 px-3 rounded-lg text-[12px] font-medium transition-colors ${
                  typeFilter === type.value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground bg-muted/30 border border-border/40'
                }`}
                aria-pressed={typeFilter === type.value}
                aria-label={`Filter by ${type.label}`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Date Range</label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {(['7d', '14d', '30d', 'mtd'] as DatePreset[]).map(preset => (
                <button
                  key={preset}
                  onClick={() => {
                    const range = getDatePresetRange(preset);
                    setStartDate(range.startDate);
                    setEndDate(range.endDate);
                  }}
                  className={`h-7 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${
                    activeDatePreset === preset
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground bg-muted/30 border border-border/40'
                  }`}
                  aria-label={`Show ${preset === 'mtd' ? 'month to date' : preset}`}
                >
                  {preset.toUpperCase()}
                </button>
              ))}
            </div>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 w-[130px] text-[13px] bg-muted/30 border-border/40 rounded-lg"
              aria-label="Start date"
            />
            <span className="text-[13px] text-muted-foreground">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 w-[130px] text-[13px] bg-muted/30 border-border/40 rounded-lg"
              aria-label="End date"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Sort By</label>
            <div className="flex gap-1.5">
              <Select value={sortBy} onValueChange={(value: 'date' | 'product' | 'quantity' | 'cost' | 'type') => setSortBy(value)}>
                <SelectTrigger className="h-8 w-[140px] text-[13px] bg-muted/30 border-border/40 rounded-lg" aria-label="Sort transactions by">
                  <SelectValue placeholder="Sort by..." />
                </SelectTrigger>
                <SelectContent className="z-50 bg-background">
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="quantity">Quantity</SelectItem>
                  <SelectItem value="cost">Total Cost</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={sortDirection === 'desc' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                className="h-8 w-8 shrink-0 rounded-lg"
                title={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                aria-label={`Sort direction: ${sortDirection === 'desc' ? 'Descending' : 'Ascending'}`}
              >
                <ArrowUpDown className={`w-3.5 h-3.5 transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Export</label>
            <ExportDropdown
              onExportCSV={handleExportCSV}
              onExportPDF={handleExportPDF}
              isExporting={isExporting}
            />
          </div>
        </div>
      </div>

      <TooltipProvider>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {TRANSACTION_TYPES.filter(t => t.value !== 'all' && t.value !== 'transfer').map(type => {
            const stats = summary[type.value as keyof typeof summary] || { count: 0, totalCost: 0 };
            const isActive = typeFilter === type.value;

            return (
              <div
                key={type.value}
                className={`cursor-pointer p-4 rounded-xl border transition-colors ${
                  isActive
                    ? 'border-foreground/30 bg-muted/50'
                    : 'border-border/40 bg-background hover:border-border'
                }`}
                onClick={() => setTypeFilter(isActive ? 'all' : type.value)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTypeFilter(isActive ? 'all' : type.value)}
                aria-pressed={isActive}
                aria-label={`Filter by ${type.label}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-medium text-muted-foreground">{type.label}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={`Information about ${type.label}`}>
                        <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-[13px] leading-relaxed">{type.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-[22px] font-semibold text-foreground leading-none">{stats.count}</div>
                <div className="text-[12px] text-muted-foreground mt-1">
                  ${Math.abs(stats.totalCost).toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>

      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-foreground">Inventory Transactions</h2>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
            {filteredTransactions.length}
          </span>
        </div>

        {error && (
          <div role="alert" className="text-[13px] text-destructive px-4 py-3 bg-destructive/10 border-b border-destructive/20">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-6 space-y-3" role="status" aria-live="polite">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <p className="sr-only">Loading transactions...</p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="mx-auto w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              <Package className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-[14px] font-medium text-muted-foreground">No transactions found</p>
            <p className="text-[13px] text-muted-foreground mt-0.5">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div className="sr-only" role="status" aria-live="polite">
              Showing {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
            </div>
            <div
              ref={listRef}
              className="h-[600px] overflow-auto"
              role="list"
              aria-label="Inventory transactions"
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const transaction = filteredTransactions[virtualRow.index];
                  if (!transaction) return null;
                  const dv = displayValuesMap.get(transaction.id);
                  if (!dv) return null;

                  return (
                    <div
                      key={transaction.id}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="px-4 py-1.5"
                    >
                      <MemoizedAuditTransactionRow
                        transaction={transaction}
                        displayValues={dv}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
