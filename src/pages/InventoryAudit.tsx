import { useState } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useInventoryTransactions } from '@/hooks/useInventoryTransactions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, TrendingDown, TrendingUp, Package, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { formatDateInTimezone } from '@/lib/timezone';
import { RestaurantSelector } from '@/components/RestaurantSelector';

const TRANSACTION_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'usage', label: 'Usage/Sale' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'waste', label: 'Waste' },
  { value: 'transfer', label: 'Transfer' },
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
    case 'purchase': return 'bg-green-100 text-green-800';
    case 'usage': return 'bg-red-100 text-red-800';
    case 'adjustment': return 'bg-blue-100 text-blue-800';
    case 'waste': return 'bg-orange-100 text-orange-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

export default function InventoryAudit() {
  const { user } = useAuth();
  const { selectedRestaurant, restaurants, setSelectedRestaurant, loading: restaurantLoading, createRestaurant } = useRestaurantContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { transactions, loading, summary, exportToCSV } = useInventoryTransactions({
    restaurantId: selectedRestaurant?.restaurant_id || null,
    typeFilter,
    startDate,
    endDate
  });

  const filteredTransactions = transactions.filter(transaction =>
    transaction.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    transaction.reason?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    transaction.reference_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
        <div className="text-center space-y-4">
          <Package className="mx-auto h-16 w-16 text-muted-foreground" />
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
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Inventory Audit Trail</h1>
        <p className="text-muted-foreground">
          Track all inventory changes including automatic deductions from POS sales, manual adjustments, and purchases.
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <Input
                placeholder="Search products, reasons..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full"
              />
            </div>
            
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
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

            <Input
              type="date"
              placeholder="Start Date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />

            <Input
              type="date"
              placeholder="End Date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />

            <Button onClick={exportToCSV} variant="outline" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {TRANSACTION_TYPES.filter(t => t.value !== 'all').map(type => {
          const stats = summary[type.value as keyof typeof summary] || { count: 0, totalCost: 0 };

          return (
            <Card key={type.value}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  {getTransactionIcon(type.value)}
                  <span className="font-medium">{type.label}</span>
                </div>
                <div className="text-2xl font-bold">{stats.count}</div>
                <div className="text-sm text-muted-foreground">
                  ${stats.totalCost.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Transactions List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory Transactions ({filteredTransactions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading transactions...</div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No transactions found for the selected filters.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTransactions.map((transaction) => (
                <div key={transaction.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge 
                          variant="secondary" 
                          className={`${getTransactionColor(transaction.transaction_type)} flex items-center gap-1`}
                        >
                          {getTransactionIcon(transaction.transaction_type)}
                          {transaction.transaction_type}
                        </Badge>
                        <h3 className="font-semibold">{transaction.product_name}</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Quantity:</span>
                          <div className={`font-medium ${transaction.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {transaction.quantity > 0 ? '+' : ''}{transaction.quantity}
                          </div>
                        </div>
                        
                        <div>
                          <span className="text-muted-foreground">Unit Cost:</span>
                          <div className="font-medium">${(transaction.unit_cost || 0).toFixed(2)}</div>
                        </div>
                        
                        <div>
                          <span className="text-muted-foreground">Total Cost:</span>
                          <div className={`font-medium ${(transaction.total_cost || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ${Math.abs(transaction.total_cost || 0).toFixed(2)}
                          </div>
                        </div>
                        
                        <div>
                          <span className="text-muted-foreground">Date:</span>
                          <div className="font-medium">
                            {formatDateInTimezone(
                              transaction.created_at,
                              selectedRestaurant.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                              'MMM dd, yyyy HH:mm'
                            )}
                          </div>
                        </div>
                      </div>

                      {transaction.reason && (
                        <div className="mt-2">
                          <span className="text-muted-foreground text-sm">Reason:</span>
                          <div className="flex items-start gap-2">
                            <div className="text-sm flex-1">{transaction.reason}</div>
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
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 shrink-0">
                                Weight
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                      {transaction.reference_id && (
                        <div className="mt-1">
                          <span className="text-muted-foreground text-sm">Reference:</span>
                          <div className="text-sm font-mono">{transaction.reference_id}</div>
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