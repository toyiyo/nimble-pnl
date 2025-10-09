import React, { useState } from 'react';
import { TrendingUp, AlertTriangle, DollarSign, Package, Download, LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    <Tabs defaultValue="pnl-trends" className="space-y-4 md:space-y-6">
      <TabsList className="grid w-full grid-cols-3 md:grid-cols-7 h-auto md:h-10">
        <TabsTrigger value="pnl-trends" className="text-xs md:text-sm">
          <span className="hidden sm:inline">P&L Trends</span>
          <span className="sm:hidden">P&L</span>
        </TabsTrigger>
        <TabsTrigger value="pnl-breakdown" className="text-xs md:text-sm">
          <span className="hidden sm:inline">P&L Detail</span>
          <span className="sm:hidden">Detail</span>
        </TabsTrigger>
        <TabsTrigger value="profitability" className="text-xs md:text-sm">
          <span className="hidden sm:inline">Recipes</span>
          <span className="sm:hidden">Recipes</span>
        </TabsTrigger>
        <TabsTrigger value="consumption" className="text-xs md:text-sm">Trends</TabsTrigger>
        <TabsTrigger value="alerts" className="text-xs md:text-sm">Alerts</TabsTrigger>
        <TabsTrigger value="variance" className="text-xs md:text-sm">Variance</TabsTrigger>
        <TabsTrigger value="pricing" className="text-xs md:text-sm">
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
  );
}