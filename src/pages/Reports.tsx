import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { TrendingUp, AlertTriangle, DollarSign, Package, Download, LineChart as LineChartIcon, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MetricIcon } from '@/components/MetricIcon';
import { PageHeader } from '@/components/PageHeader';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { RecipeIntelligenceReport } from '@/components/RecipeIntelligenceReport';
import { ConsumptionIntelligenceReport } from '@/components/ConsumptionIntelligenceReport';
import { AlertsIntelligenceReport } from '@/components/AlertsIntelligenceReport';
import { FeatureGate } from '@/components/subscription';
import { ReconciliationVarianceReport } from '@/components/ReconciliationVarianceReport';
import { PnLIntelligenceReport } from '@/components/PnLIntelligenceReport';
import { DetailedPnLBreakdown } from '@/components/DetailedPnLBreakdown';
import { PnLTrendChart } from '@/components/PnLTrendChart';
import { CostBreakdownChart } from '@/components/CostBreakdownChart';
import { SupplierPriceAnalysisReport } from '@/components/SupplierPriceAnalysisReport';
import { PeriodSelector, type Period } from '@/components/PeriodSelector';
import { subDays, parseISO, startOfDay, endOfDay, format } from 'date-fns';

interface LocationState {
  selectedDate?: string;
  reportType?: string;
}

export default function Reports() {
  const location = useLocation();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  
  // Check for navigation state from drill-down (e.g., from Budget chart)
  const navState = location.state as LocationState | null;
  
  const [selectedPeriod, setSelectedPeriod] = useState<Period>(() => {
    // If navigated with a specific date, set that day as the period
    if (navState?.selectedDate) {
      const date = parseISO(navState.selectedDate);
      return {
        type: 'custom',
        from: startOfDay(date),
        to: endOfDay(date),
        label: format(date, 'MMM d, yyyy'),
      };
    }
    return {
      type: 'last30',
      from: subDays(new Date(), 30),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
      label: 'Last 30 Days'
    };
  });

  // Handle navigation state changes
  useEffect(() => {
    if (navState?.selectedDate) {
      const date = parseISO(navState.selectedDate);
      setSelectedPeriod({
        type: 'custom',
        from: startOfDay(date),
        to: endOfDay(date),
        label: format(date, 'MMM d, yyyy'),
      });
      // Clear the state so refreshing doesn't keep the filter
      window.history.replaceState({}, document.title);
    }
  }, [navState?.selectedDate]);

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
          canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enhanced Header */}
      <PageHeader
        icon={BarChart3}
        iconVariant="blue"
        title="Reports & Analytics"
        restaurantName={selectedRestaurant?.restaurant?.name}
      />

      {/* Period Selector */}
      <PeriodSelector 
        selectedPeriod={selectedPeriod}
        onPeriodChange={setSelectedPeriod}
      />

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
        <PnLIntelligenceReport 
          restaurantId={selectedRestaurant.restaurant_id}
          dateFrom={selectedPeriod.from}
          dateTo={selectedPeriod.to}
        />
      </TabsContent>

      <TabsContent value="pnl-breakdown" className="space-y-6">
        <DetailedPnLBreakdown 
          restaurantId={selectedRestaurant.restaurant_id}
          dateFrom={selectedPeriod.from}
          dateTo={selectedPeriod.to}
        />
      </TabsContent>

      <TabsContent value="profitability" className="space-y-6">
        <FeatureGate featureKey="recipe_profitability">
          <RecipeIntelligenceReport
            restaurantId={selectedRestaurant.restaurant_id}
            dateFrom={selectedPeriod.from}
            dateTo={selectedPeriod.to}
          />
        </FeatureGate>
      </TabsContent>

      <TabsContent value="consumption" className="space-y-6">
        <ConsumptionIntelligenceReport 
          restaurantId={selectedRestaurant.restaurant_id}
          dateFrom={selectedPeriod.from}
          dateTo={selectedPeriod.to}
        />
      </TabsContent>

      <TabsContent value="alerts" className="space-y-6">
        <FeatureGate featureKey="ai_alerts">
          <AlertsIntelligenceReport
            restaurantId={selectedRestaurant.restaurant_id}
          />
        </FeatureGate>
      </TabsContent>

      <TabsContent value="variance" className="space-y-6">
        <ReconciliationVarianceReport 
          restaurantId={selectedRestaurant.restaurant_id}
        />
      </TabsContent>

      <TabsContent value="pricing" className="space-y-6">
        <SupplierPriceAnalysisReport 
          restaurantId={selectedRestaurant.restaurant_id}
          dateFrom={selectedPeriod.from}
          dateTo={selectedPeriod.to}
        />
      </TabsContent>
    </Tabs>
    </div>
  );
}