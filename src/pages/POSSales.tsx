import React, { useState } from 'react';
import { Plus, Download, Upload, Search, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { useSquareSales } from '@/hooks/useSquareSales';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { useInventoryDeduction } from '@/hooks/useInventoryDeduction';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { POSSaleDialog } from '@/components/POSSaleDialog';
import { format } from 'date-fns';
import { InventoryDeductionDialog } from '@/components/InventoryDeductionDialog';

export default function POSSales() {
  const { restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurants();
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);
  const { sales, loading, getSalesByDateRange, getSalesGroupedByItem, unmappedItems } = useSquareSales(selectedRestaurant?.restaurant_id || null);
  const { isConnected } = useSquareIntegration(selectedRestaurant?.restaurant_id || null);
  const { simulateDeduction } = useInventoryDeduction();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showSaleDialog, setShowSaleDialog] = useState(false);
  const [selectedView, setSelectedView] = useState<'sales' | 'grouped'>('sales');
  const [deductionDialogOpen, setDeductionDialogOpen] = useState(false);
  const [selectedItemForDeduction, setSelectedItemForDeduction] = useState<{name: string; quantity: number} | null>(null);

  const filteredSales = sales.filter(sale =>
    sale.items.some(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const dateFilteredSales = startDate && endDate 
    ? getSalesByDateRange(startDate, endDate)
    : filteredSales;

  const allSaleItems = dateFilteredSales.flatMap(order => order.items);

  const groupedSales = getSalesGroupedByItem();

  const handleSimulateDeduction = async (itemName: string, quantity: number) => {
    if (!selectedRestaurant?.restaurant_id) return;
    
    setSelectedItemForDeduction({ name: itemName, quantity });
    setDeductionDialogOpen(true);
  };

  if (!selectedRestaurant) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">POS Sales</h1>
          <p className="text-muted-foreground mb-8">
            Select a restaurant to manage POS sales and inventory deductions.
          </p>
          <RestaurantSelector 
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={setSelectedRestaurant}
            restaurants={restaurants} 
            loading={restaurantsLoading}
            createRestaurant={createRestaurant}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">POS Sales</h1>
            <p className="text-muted-foreground">
              Manage sales data and automatic inventory deductions for {selectedRestaurant.restaurant.name}
            </p>
          </div>
        <div className="flex gap-2">
          {!isConnected && (
            <Button
              variant="outline"
              onClick={() => setShowSaleDialog(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Record Sale
            </Button>
          )}
          <Button variant="outline" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Data
          </Button>
          {unmappedItems.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {unmappedItems.length} items need recipes
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Filters & Search</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by item name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-10"
                  placeholder="Start date"
                />
              </div>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-10"
                  placeholder="End date"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={selectedView === 'sales' ? 'default' : 'outline'}
                onClick={() => setSelectedView('sales')}
              >
                Individual Sales
              </Button>
              <Button
                variant={selectedView === 'grouped' ? 'default' : 'outline'}
                onClick={() => setSelectedView('grouped')}
              >
                Grouped by Item
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              Loading sales data...
            </div>
          </CardContent>
        </Card>
      ) : selectedView === 'sales' ? (
        <Card>
          <CardHeader>
            <CardTitle>Sales Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="text-center py-8 text-muted-foreground">
                Connect to Square to see your POS sales data automatically.
              </div>
            ) : allSaleItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No sales found for the selected date range.
              </div>
            ) : (
              <div className="space-y-4">
                {allSaleItems.map((item) => (
                  <div
                    key={`${item.order_id}-${item.id}`}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{item.name}</h3>
                        <Badge variant="secondary">
                          Qty: {item.quantity}
                        </Badge>
                        {item.total_money && (
                          <Badge variant="outline">
                            ${(item.total_money / 100).toFixed(2)}
                          </Badge>
                        )}
                        {unmappedItems.includes(item.name) && (
                          <Badge variant="destructive">
                            No Recipe
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {item.service_date && format(new Date(item.service_date), 'MMM d, yyyy')}
                        {item.catalog_object_id && ` • Item ID: ${item.catalog_object_id}`}
                        <span className="ml-2">Order: {item.order_id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSimulateDeduction(item.name, item.quantity)}
                      >
                        Simulate Impact
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sales Summary by Item</CardTitle>
          </CardHeader>
          <CardContent>
            {groupedSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No sales data available.
              </div>
            ) : (
              <div className="space-y-4">
                {groupedSales.map((item: any) => (
                  <div
                    key={item.item_name}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex-1">
                      <h3 className="font-medium">{item.item_name}</h3>
                      <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                        <span>Total Quantity: {item.total_quantity}</span>
                        <span>Sales Count: {item.sale_count}</span>
                        <span>Total Revenue: ${item.total_revenue.toFixed(2)}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSimulateDeduction(item.item_name, 1)}
                    >
                      Check Recipe Impact
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

        <POSSaleDialog
          open={showSaleDialog}
          onOpenChange={setShowSaleDialog}
          restaurantId={selectedRestaurant.restaurant_id}
        />

        {/* Inventory Deduction Dialog */}
        {selectedItemForDeduction && (
          <InventoryDeductionDialog
            isOpen={deductionDialogOpen}
            onClose={() => {
              setDeductionDialogOpen(false);
              setSelectedItemForDeduction(null);
            }}
            restaurantId={selectedRestaurant.restaurant_id}
            posItemName={selectedItemForDeduction.name}
            quantitySold={selectedItemForDeduction.quantity}
          />
        )}
    </div>
  );
}