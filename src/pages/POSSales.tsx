import React, { useState } from 'react';
import { Plus, Download, Upload, Search, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { usePOSSales } from '@/hooks/usePOSSales';
import { useInventoryDeduction } from '@/hooks/useInventoryDeduction';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { POSSaleDialog } from '@/components/POSSaleDialog';
import { format } from 'date-fns';

export default function POSSales() {
  const { restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurants();
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);
  const { sales, loading, getSalesByDateRange, getSalesGroupedByItem } = usePOSSales(selectedRestaurant?.restaurant_id || null);
  const { simulateDeduction } = useInventoryDeduction();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showSaleDialog, setShowSaleDialog] = useState(false);
  const [selectedView, setSelectedView] = useState<'sales' | 'grouped'>('sales');

  const filteredSales = sales.filter(sale =>
    sale.pos_item_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const dateFilteredSales = startDate && endDate 
    ? getSalesByDateRange(startDate, endDate)
    : filteredSales;

  const groupedSales = getSalesGroupedByItem();

  const handleSimulateDeduction = async (itemName: string, quantity: number) => {
    if (!selectedRestaurant?.restaurant_id) return;
    
      const result = await simulateDeduction(
        selectedRestaurant.restaurant_id,
        itemName,
        quantity
      );
    
    if (result) {
      console.log('Simulation result:', result);
      // Could show a dialog with the simulation results
    }
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
          <Button
            variant="outline"
            onClick={() => setShowSaleDialog(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Record Sale
          </Button>
          <Button variant="outline" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Sales
          </Button>
          <Button variant="outline" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Data
          </Button>
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
            {dateFilteredSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No sales found. Record your first sale to get started.
              </div>
            ) : (
              <div className="space-y-4">
                {dateFilteredSales.map((sale) => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{sale.pos_item_name}</h3>
                        <Badge variant="secondary">
                          Qty: {sale.quantity}
                        </Badge>
                        {sale.sale_price && (
                          <Badge variant="outline">
                            ${sale.sale_price.toFixed(2)}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {format(new Date(sale.sale_date), 'MMM d, yyyy')}
                        {sale.sale_time && ` at ${sale.sale_time}`}
                        {sale.pos_item_id && ` • POS ID: ${sale.pos_item_id}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSimulateDeduction(sale.pos_item_name, sale.quantity)}
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
    </div>
  );
}