import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { MetricIcon } from '@/components/MetricIcon';
import { FileText, Download, Calendar } from 'lucide-react';
import { IncomeStatement } from '@/components/financial-statements/IncomeStatement';
import { BalanceSheet } from '@/components/financial-statements/BalanceSheet';
import { CashFlowStatement } from '@/components/financial-statements/CashFlowStatement';
import { TrialBalance } from '@/components/financial-statements/TrialBalance';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { addMonths, startOfMonth, endOfMonth } from 'date-fns';

const FinancialStatements = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const [dateRange, setDateRange] = useState({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
          <MetricIcon icon={FileText} variant="blue" className="mx-auto mb-4" />
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Financial Statements</h2>
          <p className="text-sm md:text-base text-muted-foreground">
            Please select a restaurant to view financial statements
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
    <div className="space-y-6 md:space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-4">
            <MetricIcon icon={FileText} variant="blue" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Financial Statements</h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">
                View comprehensive financial reports for your restaurant
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-0" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl -z-0" />
      </div>

      {/* Date Range Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Report Period</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
              <DateRangePicker
                from={dateRange.from}
                to={dateRange.to}
                onSelect={(range) => {
                  if (range?.from && range?.to) {
                    setDateRange({ from: range.from, to: range.to });
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDateRange({
                    from: startOfMonth(addMonths(new Date(), -1)),
                    to: endOfMonth(addMonths(new Date(), -1)),
                  });
                }}
              >
                Last Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDateRange({
                    from: startOfMonth(new Date()),
                    to: endOfMonth(new Date()),
                  });
                }}
              >
                This Month
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Statement Tabs */}
      <Tabs defaultValue="income-statement" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="income-statement">Income Statement</TabsTrigger>
          <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
          <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
        </TabsList>

        <TabsContent value="income-statement">
          <IncomeStatement
            restaurantId={selectedRestaurant.restaurant_id}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
          />
        </TabsContent>

        <TabsContent value="balance-sheet">
          <BalanceSheet
            restaurantId={selectedRestaurant.restaurant_id}
            asOfDate={dateRange.to}
          />
        </TabsContent>

        <TabsContent value="cash-flow">
          <CashFlowStatement
            restaurantId={selectedRestaurant.restaurant_id}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
          />
        </TabsContent>

        <TabsContent value="trial-balance">
          <TrialBalance
            restaurantId={selectedRestaurant.restaurant_id}
            asOfDate={dateRange.to}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FinancialStatements;