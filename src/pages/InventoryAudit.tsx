import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingDown, TrendingUp, Package, AlertTriangle, Info, X, ClipboardList, Calendar, DollarSign, Activity, ArrowUpDown } from 'lucide-react';
import { format } from 'date-fns';
import { useState, useMemo } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useInventoryTransactions } from '@/hooks/useInventoryTransactions';
import { formatDateInTimezone } from '@/lib/timezone';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MetricIcon } from '@/components/MetricIcon';
import { ExportDropdown } from '@/components/financial-statements/shared/ExportDropdown';
import { generateTablePDF } from '@/utils/pdfExport';
import { useToast } from '@/hooks/use-toast';

const TRANSACTION_TYPES = [
  { 
    value: 'all', 
    label: 'All Types',
    description: 'All inventory transactions',
    tooltip: 'Shows all types of inventory movements'
  },
  { 
    value: 'purchase', 
    label: 'Purchases',
    description: 'Inventory added to stock',
    tooltip: 'Items purchased and added to your inventory. Amount represents the cost you paid for these items.'
  },
  { 
    value: 'usage', 
    label: 'Cost of Goods Used',
    description: 'Inventory cost consumed',
    tooltip: 'The cost of inventory that was used or sold. This is NOT the retail price charged to customers, but rather the cost of ingredients/products deducted from inventory.'
  },
  { 
    value: 'adjustment', 
    label: 'Adjustments',
    description: 'Manual inventory corrections',
    tooltip: 'Manual corrections to inventory levels (e.g., corrections from reconciliations, found items, or count adjustments).'
  },
  { 
    value: 'waste', 
    label: 'Waste',
    description: 'Spoilage & disposal value',
    tooltip: 'Value of inventory lost due to spoilage, damage, or disposal. Represents the cost of wasted items.'
  },
  { 
    value: 'transfer', 
    label: 'Transfers',
    description: 'Items moved between locations',
    tooltip: 'Inventory transferred between different storage locations or restaurants.'
  },
];

const getTransactionIcon = (type: string) => {
  switch (type) {
    case 'purchase': return <TrendingUp className="h-4 w-4" />;
    case 'usage': return <TrendingDown className="h-4 w-4" />;
    case 'adjustment': return <Package className="h-4 w-4" />;
    case 'waste': return <AlertTriangle className="h-4 w-4" />;
    default: return <Package className="h-4 w-4" />;
  }
};

const getTransactionColor = (type: string) => {
  switch (type) {
    case 'purchase': return 'bg-emerald-100 text-emerald-700';
    case 'usage': return 'bg-rose-100 text-rose-700';
    case 'adjustment': return 'bg-blue-100 text-blue-700';
    case 'waste': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};

const getTransactionBorderColor = (type: string) => {
  switch (type) {
    case 'purchase': return 'border-l-emerald-500';
    case 'usage': return 'border-l-rose-500';
    case 'adjustment': return 'border-l-blue-500';
    case 'waste': return 'border-l-amber-500';
    default: return 'border-l-gray-500';
  }
};

export default function InventoryAudit() {
  const { user } = useAuth();
  const { selectedRestaurant, restaurants, setSelectedRestaurant, loading: restaurantLoading, createRestaurant } = useRestaurantContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'product' | 'quantity' | 'cost' | 'type'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const { transactions, loading, error, summary, exportToCSV: exportTransactionsToCSV } = useInventoryTransactions({
    restaurantId: selectedRestaurant?.restaurant_id || null,
    typeFilter,
    startDate,
    endDate
  });

  // ✅ SAFE MEMOIZATION: Only recalculate when dependencies change
  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter(transaction =>
      transaction.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (transaction.reason || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (transaction.reference_id || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Apply sorting
    return filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          // Use transaction_date if available, otherwise use created_at
          const aDate = a.transaction_date || a.created_at;
          const bDate = b.transaction_date || b.created_at;
          comparison = new Date(aDate).getTime() - new Date(bDate).getTime();
          if (comparison === 0) {
            comparison = a.id.localeCompare(b.id);
          }
          break;
        case 'product':
          comparison = a.product_name.localeCompare(b.product_name);
          if (comparison === 0) {
            const aDate = a.transaction_date || a.created_at;
            const bDate = b.transaction_date || b.created_at;
            comparison = new Date(bDate).getTime() - new Date(aDate).getTime();
          }
          break;
        case 'quantity':
          comparison = Math.abs(a.quantity) - Math.abs(b.quantity);
          if (comparison === 0) {
            const aDate = a.transaction_date || a.created_at;
            const bDate = b.transaction_date || b.created_at;
            comparison = new Date(bDate).getTime() - new Date(aDate).getTime();
          }
          break;
        case 'cost':
          comparison = Math.abs(a.total_cost || 0) - Math.abs(b.total_cost || 0);
          if (comparison === 0) {
            const aDate = a.transaction_date || a.created_at;
            const bDate = b.transaction_date || b.created_at;
            comparison = new Date(bDate).getTime() - new Date(aDate).getTime();
          }
          break;
        case 'type':
          comparison = a.transaction_type.localeCompare(b.transaction_type);
          if (comparison === 0) {
            const aDate = a.transaction_date || a.created_at;
            const bDate = b.transaction_date || b.created_at;
            comparison = new Date(bDate).getTime() - new Date(aDate).getTime();
          }
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [transactions, searchTerm, sortBy, sortDirection]);

  const activeFiltersCount = [typeFilter !== 'all', startDate, endDate, searchTerm].filter(Boolean).length;

  const clearFilters = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setStartDate('');
    setEndDate('');
    setSortBy('date');
    setSortDirection('desc');
  };

  const handleExportCSV = async () => {
    // Validate date range
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      toast({
        title: 'Invalid date range',
        description: 'Start date must be before end date.',
        variant: 'destructive',
      });
      return;
    }
    
    setIsExporting(true);
    try {
      await exportTransactionsToCSV();
      toast({
        title: "Export Successful",
        description: "Inventory audit data exported to CSV",
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error exporting CSV:", error);
      }
      toast({
        title: "Export Failed",
        description: "Failed to export audit data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    // Validate date range
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      toast({
        title: 'Invalid date range',
        description: 'Start date must be before end date.',
        variant: 'destructive',
      });
      return;
    }
    
    setIsExporting(true);
    try {
      const columns = ["Date", "Product", "Type", "Quantity", "Unit Cost", "Total Cost", "Reason"];
      const rows = filteredTransactions.map((transaction) => [
        transaction.transaction_date 
          ? formatDateInTimezone(transaction.transaction_date, selectedRestaurant?.restaurant.timezone || 'UTC', 'MMM dd, yyyy')
          : formatDateInTimezone(transaction.created_at, selectedRestaurant?.restaurant.timezone || 'UTC', 'MMM dd, yyyy'),
        transaction.product_name,
        transaction.transaction_type.charAt(0).toUpperCase() + transaction.transaction_type.slice(1),
        transaction.quantity.toFixed(2),
        `$${(transaction.unit_cost || 0).toFixed(2)}`,
        `$${(transaction.total_cost || 0).toFixed(2)}`,
        transaction.reason || '-',
      ]);

      const dateRange = startDate && endDate 
        ? `${startDate} to ${endDate}` 
        : startDate 
        ? `From ${startDate}`
        : endDate 
        ? `To ${endDate}`
        : "All Time";

      const filterLabel = typeFilter !== 'all' 
        ? ` - ${TRANSACTION_TYPES.find(t => t.value === typeFilter)?.label || 'Filtered'}`
        : '';

      generateTablePDF({
        title: `Inventory Audit Trail${filterLabel}`,
        restaurantName: selectedRestaurant?.restaurant.name || "",
        dateRange,
        columns,
        rows,
        filename: `inventory_audit_${format(new Date(), "yyyyMMdd_HHmmss")}.pdf`,
      });

      toast({
        title: "Export Successful",
        description: "Inventory audit report exported to PDF",
      });
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export audit report",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p>Please log in to access inventory audit.</p>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="bg-gradient-to-br from-muted/50 to-transparent">
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center">
                <Package className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold">Select a Restaurant</h2>
              <p className="text-muted-foreground">Choose a restaurant to view inventory audit trail.</p>
              <RestaurantSelector
                restaurants={restaurants}
                selectedRestaurant={selectedRestaurant}
                onSelectRestaurant={setSelectedRestaurant}
                loading={restaurantLoading}
                createRestaurant={createRestaurant}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <Card className="mb-6 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <MetricIcon 
              icon={Activity} 
              className="text-primary transition-transform duration-300 group-hover:scale-110" 
            />
            <div className="flex-1">
              <h1 className="text-3xl font-bold mb-2 tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Inventory Audit Trail
              </h1>
              <p className="text-muted-foreground leading-relaxed">
                Track all inventory changes including automatic deductions from POS sales, manual adjustments, and purchases.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="mb-6 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Filters & Sorting</CardTitle>
            {activeFiltersCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={clearFilters}
                className="h-8 gap-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
                Clear {activeFiltersCount} {activeFiltersCount === 1 ? 'filter' : 'filters'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
            <div className="space-y-2">
              <label htmlFor="search-input" className="text-sm font-medium text-muted-foreground">Search</label>
              <Input
                id="search-input"
                placeholder="Products, reasons..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full"
                aria-label="Search transactions by product, reason, or reference"
              />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="type-filter" className="text-sm font-medium text-muted-foreground">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger id="type-filter" aria-label="Filter by transaction type">
                  <SelectValue placeholder="Transaction Type" />
                </SelectTrigger>
                <SelectContent>
                  {TRANSACTION_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="start-date" className="text-sm font-medium text-muted-foreground">Start Date</label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Filter transactions from date"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="end-date" className="text-sm font-medium text-muted-foreground">End Date</label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Filter transactions to date"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Sort By</label>
              <div className="flex gap-2">
                <Select value={sortBy} onValueChange={(value: 'date' | 'product' | 'quantity' | 'cost' | 'type') => setSortBy(value)}>
                  <SelectTrigger className="flex-1 border-border/50 hover:border-primary/50 transition-colors" aria-label="Sort transactions by">
                    <SelectValue placeholder="Sort by..." />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-background">
                    <SelectItem value="date">📅 Date</SelectItem>
                    <SelectItem value="product">📦 Product</SelectItem>
                    <SelectItem value="quantity">🔢 Quantity</SelectItem>
                    <SelectItem value="cost">💰 Total Cost</SelectItem>
                    <SelectItem value="type">📋 Type</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant={sortDirection === 'desc' ? 'default' : 'outline'}
                  size="icon"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="shrink-0"
                  title={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                  aria-label={`Sort direction: ${sortDirection === 'desc' ? 'Descending' : 'Ascending'}`}
                >
                  <ArrowUpDown className={`w-4 h-4 transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Export</label>
              <div className="w-full">
                <ExportDropdown
                  onExportCSV={handleExportCSV}
                  onExportPDF={handleExportPDF}
                  isExporting={isExporting}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <TooltipProvider>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {TRANSACTION_TYPES.filter(t => t.value !== 'all').map(type => {
            const stats = summary[type.value as keyof typeof summary] || { count: 0, totalCost: 0 };
            const isActive = typeFilter === type.value;

            return (
              <Card 
                key={type.value}
                className={`cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02] group ${
                  isActive 
                    ? 'ring-2 ring-primary shadow-lg bg-gradient-to-br from-primary/5 to-accent/5' 
                    : 'hover:border-primary/30'
                }`}
                onClick={() => setTypeFilter(type.value)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTypeFilter(type.value)}
                aria-pressed={isActive}
                aria-label={`Filter by ${type.label}`}
              >
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-lg shadow-sm transition-transform duration-300 group-hover:scale-110 ${getTransactionColor(type.value)}`}>
                        {getTransactionIcon(type.value)}
                      </div>
                      <span className="font-semibold text-sm">{type.label}</span>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label={`Information about ${type.label}`}>
                          <Info className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-sm leading-relaxed">{type.tooltip}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="space-y-2">
                    <div className="text-3xl font-bold tracking-tight leading-none">{stats.count}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                      {stats.count === 1 ? 'Transaction' : 'Transactions'}
                    </div>
                    <div className="flex items-center gap-1.5 pt-2 border-t mt-3">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-lg font-bold">
                        {Math.abs(stats.totalCost).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Transactions List */}
      <Card className="shadow-sm">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5" />
            Inventory Transactions
            <Badge variant="secondary" className="ml-2 font-normal">
              {filteredTransactions.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div role="alert" className="text-sm text-destructive px-4 py-3 bg-destructive/10 border-b border-destructive/20">
              {error}
            </div>
          )}
          {loading ? (
            <div className="p-6 space-y-4" role="status" aria-live="polite">
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
              <p className="text-sm text-center text-muted-foreground sr-only">Loading transactions...</p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center mb-4">
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No transactions found</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="divide-y" role="list" aria-label="Inventory transactions">
              <div className="sr-only" role="status" aria-live="polite">
                Showing {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
              </div>
              {filteredTransactions.map((transaction, index) => (
                <div 
                  key={transaction.id} 
                  className={`border-l-4 ${getTransactionBorderColor(transaction.transaction_type)} p-5 hover:bg-accent/50 transition-all duration-200 ${
                    index % 2 === 0 ? 'bg-muted/10' : ''
                  }`}
                  role="listitem"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge 
                          variant="secondary" 
                          className={`${getTransactionColor(transaction.transaction_type)} flex items-center gap-1.5 px-2.5 py-1 shadow-sm`}
                        >
                          {getTransactionIcon(transaction.transaction_type)}
                          <span className="font-medium capitalize">{transaction.transaction_type}</span>
                        </Badge>
                        <h3 className="font-semibold text-base leading-tight">{transaction.product_name}</h3>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium uppercase tracking-wide">
                            <Package className="h-3.5 w-3.5" />
                            Quantity
                          </div>
                          <div className={`font-bold text-lg leading-none ${transaction.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {transaction.quantity > 0 ? '+' : ''}{Number(transaction.quantity).toFixed(2)}
                          </div>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium uppercase tracking-wide">
                            <DollarSign className="h-3.5 w-3.5" />
                            Unit Cost
                          </div>
                          <div className="font-bold text-lg leading-none">${(transaction.unit_cost || 0).toFixed(2)}</div>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium uppercase tracking-wide">
                            <DollarSign className="h-3.5 w-3.5" />
                            Total Cost
                          </div>
                          <div className={`font-bold text-lg leading-none ${(transaction.total_cost || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            ${Math.abs(transaction.total_cost || 0).toFixed(2)}
                          </div>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium uppercase tracking-wide">
                            <Calendar className="h-3.5 w-3.5" />
                            Date
                          </div>
                          <div className="font-semibold text-sm leading-tight">
                            {formatDateInTimezone(
                              transaction.transaction_date || transaction.created_at,
                              selectedRestaurant.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                              transaction.transaction_date ? 'MMM dd, yyyy' : 'MMM dd, yyyy HH:mm'
                            )}
                          </div>
                        </div>
                      </div>

                      {transaction.reason && (
                        <div className="pt-2 space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason</div>
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="text-sm leading-relaxed flex-1 min-w-0">{transaction.reason}</div>
                            {transaction.reason.includes('⚠️ FALLBACK') && (
                              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1 shrink-0">
                                <AlertTriangle className="h-3 w-3" />
                                1:1 Fallback
                              </Badge>
                            )}
                            {transaction.reason.includes('✓ VOL') && (
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 shrink-0">
                                Volume
                              </Badge>
                            )}
                            {transaction.reason.includes('✓ WEIGHT') && (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 shrink-0">
                                Weight
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                      {transaction.reference_id && (
                        <div className="pt-2 space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reference ID</div>
                          <div className="text-sm font-mono bg-muted/50 rounded px-2 py-1 break-all max-w-full">
                            {transaction.reference_id}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}