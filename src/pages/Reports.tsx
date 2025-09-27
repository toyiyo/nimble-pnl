import React, { useState } from 'react';
import { TrendingUp, AlertTriangle, DollarSign, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useRecipeAnalytics } from '@/hooks/useRecipeAnalytics';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { RecipeProfitabilityChart } from '@/components/RecipeProfitabilityChart';
import { ConsumptionTrendsChart } from '@/components/ConsumptionTrendsChart';
import { VarianceAnalysis } from '@/components/VarianceAnalysis';

export default function Reports() {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  
  const { 
    profitabilityData, 
    consumptionData, 
    loading: analyticsLoading 
  } = useRecipeAnalytics(selectedRestaurant?.restaurant_id || null);
  
  const { 
    lowStockItems, 
    reorderAlerts, 
    loading: alertsLoading 
  } = useInventoryAlerts(selectedRestaurant?.restaurant_id || null);

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Reports & Analytics</h1>
          <p className="text-muted-foreground mb-8">
            Select a restaurant to view detailed analytics and reports.
          </p>
        </div>
        <RestaurantSelector 
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          restaurants={restaurants} 
          loading={restaurantsLoading}
          createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  return (
    <Tabs defaultValue="profitability" className="space-y-4 md:space-y-6">
      <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto md:h-10">
        <TabsTrigger value="profitability" className="text-xs md:text-sm">
          <span className="hidden sm:inline">Recipe Analysis</span>
          <span className="sm:hidden">Recipes</span>
        </TabsTrigger>
        <TabsTrigger value="consumption" className="text-xs md:text-sm">Trends</TabsTrigger>
        <TabsTrigger value="alerts" className="text-xs md:text-sm">Alerts</TabsTrigger>
        <TabsTrigger value="variance" className="text-xs md:text-sm">Variance</TabsTrigger>
      </TabsList>

      <TabsContent value="profitability" className="space-y-6">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Recipe Profitability Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analyticsLoading ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Loading profitability data...</p>
                </div>
              ) : (
                <RecipeProfitabilityChart data={profitabilityData} />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            <Card>
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm">Highest Margin</CardTitle>
              </CardHeader>
              <CardContent>
                {profitabilityData?.highestMargin ? (
                  <div>
                    <p className="font-medium text-sm truncate">{profitabilityData.highestMargin.name}</p>
                    <p className="text-xl md:text-2xl font-bold text-green-600">
                      {profitabilityData.highestMargin.margin.toFixed(1)}%
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No data</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm">Lowest Margin</CardTitle>
              </CardHeader>
              <CardContent>
                {profitabilityData?.lowestMargin ? (
                  <div>
                    <p className="font-medium text-sm truncate">{profitabilityData.lowestMargin.name}</p>
                    <p className="text-xl md:text-2xl font-bold text-red-600">
                      {profitabilityData.lowestMargin.margin.toFixed(1)}%
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No data</p>
                )}
              </CardContent>
            </Card>

            <Card className="sm:col-span-2 lg:col-span-1">
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm">Avg Food Cost %</CardTitle>
              </CardHeader>
              <CardContent>
                {profitabilityData?.averageFoodCost ? (
                  <div>
                    <p className="text-xl md:text-2xl font-bold text-primary">
                      {profitabilityData.averageFoodCost.toFixed(1)}%
                    </p>
                    <p className="text-xs md:text-sm text-muted-foreground">Across all recipes</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No data</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="consumption" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Ingredient Consumption Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Loading consumption data...</p>
              </div>
            ) : (
              <ConsumptionTrendsChart data={consumptionData} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="alerts" className="space-y-6">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Reorder Alerts
                {reorderAlerts.length > 0 && (
                  <Badge variant="destructive">{reorderAlerts.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Loading alerts...</p>
                </div>
              ) : reorderAlerts.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">All inventory levels are healthy!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reorderAlerts.map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{alert.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          Current: {alert.current_stock} {alert.uom_purchase} • 
                          Reorder at: {alert.reorder_point}
                        </p>
                      </div>
                      <Badge variant={alert.current_stock === 0 ? "destructive" : "secondary"}>
                        {alert.current_stock === 0 ? "Out of Stock" : "Low Stock"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Low Stock Items</CardTitle>
            </CardHeader>
            <CardContent>
              {lowStockItems.length === 0 ? (
                <p className="text-muted-foreground">No low stock items</p>
              ) : (
                <div className="space-y-2">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="flex justify-between items-center">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {item.current_stock} {item.uom_purchase}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="variance" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Theoretical vs Actual Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <VarianceAnalysis restaurantId={selectedRestaurant.restaurant_id} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}