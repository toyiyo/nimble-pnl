import { useState, useEffect } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useOperatingCosts } from '@/hooks/useOperatingCosts';
import { useBreakEvenAnalysis } from '@/hooks/useBreakEvenAnalysis';
import { BreakEvenHeroCard } from '@/components/budget/BreakEvenHeroCard';
import { CostBlock } from '@/components/budget/CostBlock';
import { CostItemDialog } from '@/components/budget/CostItemDialog';
import { SalesVsBreakEvenChart } from '@/components/budget/SalesVsBreakEvenChart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Target, Plus } from 'lucide-react';
import { CostType, OperatingCostInput, CostBreakdownItem } from '@/types/operatingCosts';

export default function BudgetRunRate() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  
  const {
    costs,
    fixedCosts,
    semiVariableCosts,
    variableCosts,
    customCosts,
    isLoading: costsLoading,
    createCost,
    updateCost,
    deleteCost,
    seedDefaults,
    isSeeding,
  } = useOperatingCosts(restaurantId);
  
  const { data: breakEvenData, isLoading: analysisLoading } = useBreakEvenAnalysis(restaurantId);
  
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CostBreakdownItem | null>(null);
  const [dialogCostType, setDialogCostType] = useState<CostType>('custom');
  
  // Seed defaults if no costs exist
  useEffect(() => {
    if (!costsLoading && costs.length === 0 && restaurantId && !isSeeding) {
      seedDefaults();
    }
  }, [costsLoading, costs.length, restaurantId, isSeeding, seedDefaults]);
  
  const handleAddItem = (costType: CostType) => {
    setEditingItem(null);
    setDialogCostType(costType);
    setDialogOpen(true);
  };
  
  const handleEditItem = (item: CostBreakdownItem) => {
    setEditingItem(item);
    // Find the cost type from the original costs array
    const originalCost = costs.find(c => c.id === item.id);
    setDialogCostType(originalCost?.costType || 'custom');
    setDialogOpen(true);
  };
  
  const handleSaveItem = (data: OperatingCostInput) => {
    if (editingItem) {
      updateCost({
        id: editingItem.id,
        name: data.name,
        entryType: data.entryType,
        monthlyValue: data.monthlyValue,
        percentageValue: data.percentageValue,
        manualOverride: true,
      });
    } else {
      createCost(data);
    }
  };
  
  const handleDeleteItem = (id: string) => {
    deleteCost(id);
  };
  
  const isLoading = costsLoading || analysisLoading;

  if (!restaurantId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Budget & Run Rate</h1>
          <p className="text-muted-foreground mt-1">
            Please select a restaurant to view your budget.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Target className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Budget & Run Rate</h1>
              <p className="text-muted-foreground mt-1">
                Understand your daily cost to operate — and whether sales are keeping up.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Hero: Daily Break-Even */}
      <BreakEvenHeroCard data={breakEvenData} isLoading={isLoading} />
      
      {/* Cost Structure Section */}
      <Card>
        <CardHeader>
          <CardTitle>What makes up your daily cost</CardTitle>
          <CardDescription>
            Configure your fixed and variable operating costs to calculate your break-even point
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              {/* Fixed Costs */}
              <CostBlock
                title="Fixed Costs"
                subtitle="Costs that don't change with sales"
                totalDaily={breakEvenData?.fixedCosts.totalDaily || 0}
                items={breakEvenData?.fixedCosts.items || []}
                onAddItem={() => handleAddItem('fixed')}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
                showAddButton
              />
              
              {/* Semi-Variable (Utilities) */}
              <CostBlock
                title="Utilities (Averaged)"
                subtitle="Estimated from historical usage"
                totalDaily={breakEvenData?.semiVariableCosts.totalDaily || 0}
                items={breakEvenData?.semiVariableCosts.items || []}
                onEditItem={handleEditItem}
                infoText={`Smoothed from last ${breakEvenData?.semiVariableCosts.monthsAveraged || 3} months of transactions. Override any value to set manually.`}
              />
              
              {/* Variable Costs */}
              <CostBlock
                title="Variable Costs"
                subtitle="Costs that scale with sales"
                totalDaily={breakEvenData?.variableCosts.totalDaily || 0}
                items={breakEvenData?.variableCosts.items || []}
                onEditItem={handleEditItem}
                showPercentages
              />
              
              {/* Custom Costs */}
              <CostBlock
                title="Custom / Other Costs"
                subtitle="Franchise fees, marketing, etc."
                totalDaily={breakEvenData?.customCosts.totalDaily || 0}
                items={breakEvenData?.customCosts.items || []}
                onAddItem={() => handleAddItem('custom')}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
                showAddButton
              />
            </>
          )}
        </CardContent>
      </Card>
      
      {/* Sales vs Cost Reality Chart */}
      <SalesVsBreakEvenChart data={breakEvenData} isLoading={isLoading} />
      
      {/* Cost Item Dialog */}
      <CostItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveItem}
        editingItem={editingItem}
        costType={dialogCostType}
        title={
          dialogCostType === 'fixed' ? 'Add Fixed Cost' :
          dialogCostType === 'variable' ? 'Add Variable Cost' :
          'Add Custom Cost'
        }
      />
    </div>
  );
}
