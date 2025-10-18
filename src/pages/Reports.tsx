import React, { useState } from 'react';
import { TrendingUp, AlertTriangle, DollarSign, Package, Download, LineChart as LineChartIcon, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MetricIcon } from '@/components/MetricIcon';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { RecipeIntelligenceReport } from '@/components/RecipeIntelligenceReport';
import { ConsumptionIntelligenceReport } from '@/components/ConsumptionIntelligenceReport';
import { AlertsIntelligenceReport } from '@/components/AlertsIntelligenceReport';
import { ReconciliationVarianceReport } from '@/components/ReconciliationVarianceReport';
import { PnLIntelligenceReport } from '@/components/PnLIntelligenceReport';
import { DetailedPnLBreakdown } from '@/components/DetailedPnLBreakdown';
import { PnLTrendChart } from '@/components/PnLTrendChart';
import { CostBreakdownChart } from '@/components/CostBreakdownChart';
import { SupplierPriceAnalysisReport } from '@/components/SupplierPriceAnalysisReport';

export default function Reports() {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="relative overflow-hidden bg-gradient-to-br from-background via-primary/5 to-accent/5 border-2 border-transparent bg-clip-padding rounded-lg p-8 text-center">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent opacity-50" />
          <div className="relative">
            <div className="flex items-center justify-center gap-4 mb-4">
              <MetricIcon icon={BarChart3} variant="blue" />
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
                Reports & Analytics
              </h1>
            </div>
            <p className="text-muted-foreground">
              Select a restaurant to view detailed analytics and reports.
            </p>
          </div>
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
    <div className="space-y-6">
      {/* Enhanced Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-background via-primary/5 to-accent/5 border-2 border-transparent bg-clip-padding rounded-lg p-6">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent opacity-50" />
        <div className="relative flex items-center gap-4">
          <MetricIcon icon={BarChart3} variant="blue" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              Reports & Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse mr-2" aria-hidden="true" />
              {selectedRestaurant?.restaurant?.name}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="pnl-trends" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-7 h-auto md:h-10" role="tablist">
          <TabsTrigger value="pnl-trends" className="text-xs md:text-sm" aria-label="P&L Trends report">
            <span className="hidden sm:inline">P&L Trends</span>
            <span className="sm:hidden">P&L</span>
          </TabsTrigger>
          <TabsTrigger value="pnl-breakdown" className="text-xs md:text-sm" aria-label="Detailed P&L breakdown">
            <span className="hidden sm:inline">P&L Detail</span>
            <span className="sm:hidden">Detail</span>
          </TabsTrigger>
          <TabsTrigger value="profitability" className="text-xs md:text-sm" aria-label="Recipe profitability report">
            <span className="hidden sm:inline">Recipes</span>
            <span className="sm:hidden">Recipes</span>
          </TabsTrigger>
          <TabsTrigger value="consumption" className="text-xs md:text-sm" aria-label="Consumption trends report">Trends</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs md:text-sm" aria-label="Inventory alerts report">Alerts</TabsTrigger>
          <TabsTrigger value="variance" className="text-xs md:text-sm" aria-label="Variance analysis report">Variance</TabsTrigger>
          <TabsTrigger value="pricing" className="text-xs md:text-sm" aria-label="Supplier pricing analysis">
            <span className="hidden sm:inline">Pricing</span>
            <span className="sm:hidden">Price</span>
          </TabsTrigger>
        </TabsList>

      <TabsContent value="pnl-trends" className="space-y-6">
        <PnLIntelligenceReport restaurantId={selectedRestaurant.restaurant_id} />
      </TabsContent>

      <TabsContent value="pnl-breakdown" className="space-y-6">
        <DetailedPnLBreakdown restaurantId={selectedRestaurant.restaurant_id} days={30} />
      </TabsContent>

      <TabsContent value="profitability" className="space-y-6">
        <RecipeIntelligenceReport restaurantId={selectedRestaurant.restaurant_id} />
      </TabsContent>

      <TabsContent value="consumption" className="space-y-6">
        <ConsumptionIntelligenceReport restaurantId={selectedRestaurant.restaurant_id} />
      </TabsContent>

      <TabsContent value="alerts" className="space-y-6">
        <AlertsIntelligenceReport restaurantId={selectedRestaurant.restaurant_id} />
      </TabsContent>

      <TabsContent value="variance" className="space-y-6">
        <ReconciliationVarianceReport restaurantId={selectedRestaurant.restaurant_id} />
      </TabsContent>

      <TabsContent value="pricing" className="space-y-6">
        <SupplierPriceAnalysisReport restaurantId={selectedRestaurant.restaurant_id} />
      </TabsContent>
    </Tabs>
    </div>
  );
}