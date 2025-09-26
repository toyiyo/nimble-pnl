import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface VarianceItem {
  product_name: string;
  theoretical_usage: number;
  actual_usage: number;
  variance: number;
  variance_percentage: number;
  cost_impact: number;
}

interface VarianceAnalysisProps {
  restaurantId: string;
}

export const VarianceAnalysis: React.FC<VarianceAnalysisProps> = ({ restaurantId }) => {
  const [varianceData, setVarianceData] = useState<VarianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchVarianceData();
  }, [restaurantId]);

  const fetchVarianceData = async () => {
    try {
      setLoading(true);

      // Get last 7 days of sales and calculate theoretical usage
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Get POS sales for the period
      const { data: sales, error: salesError } = await supabase
        .from('pos_sales')
        .select('pos_item_name, quantity')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', startDate)
        .lte('sale_date', endDate);

      if (salesError) throw salesError;

      // Get recipes and their ingredients
      const { data: recipes, error: recipesError } = await supabase
        .from('recipes')
        .select(`
          pos_item_name,
          recipe_ingredients!inner(
            quantity,
            product:products(name, cost_per_unit)
          )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true);

      if (recipesError) throw recipesError;

      // Get actual usage from inventory transactions
      const { data: transactions, error: transactionsError } = await supabase
        .from('inventory_transactions')
        .select(`
          quantity,
          product:products(name, cost_per_unit)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'sale_deduction')
        .gte('created_at', startDate + 'T00:00:00Z')
        .lte('created_at', endDate + 'T23:59:59Z');

      if (transactionsError) throw transactionsError;

      // Calculate theoretical usage based on recipes and sales
      const theoreticalUsage: { [productName: string]: number } = {};
      
      (sales || []).forEach(sale => {
        const recipe = recipes?.find(r => r.pos_item_name === sale.pos_item_name);
        if (recipe) {
          recipe.recipe_ingredients.forEach(ingredient => {
            const productName = ingredient.product?.name;
            if (productName) {
              if (!theoreticalUsage[productName]) {
                theoreticalUsage[productName] = 0;
              }
              theoreticalUsage[productName] += ingredient.quantity * sale.quantity;
            }
          });
        }
      });

      // Calculate actual usage from transactions
      const actualUsage: { [productName: string]: number } = {};
      
      (transactions || []).forEach(transaction => {
        const productName = transaction.product?.name;
        if (productName) {
          if (!actualUsage[productName]) {
            actualUsage[productName] = 0;
          }
          actualUsage[productName] += Math.abs(transaction.quantity);
        }
      });

      // Calculate variance for each product
      const varianceItems: VarianceItem[] = [];
      
      Object.keys({ ...theoreticalUsage, ...actualUsage }).forEach(productName => {
        const theoretical = theoreticalUsage[productName] || 0;
        const actual = actualUsage[productName] || 0;
        const variance = actual - theoretical;
        const variancePercentage = theoretical > 0 ? (variance / theoretical) * 100 : 0;
        
        // Get cost per unit for cost impact calculation
        const productTransaction = transactions?.find(t => t.product?.name === productName);
        const costPerUnit = productTransaction?.product?.cost_per_unit || 0;
        const costImpact = variance * costPerUnit;

        if (theoretical > 0 || actual > 0) {
          varianceItems.push({
            product_name: productName,
            theoretical_usage: theoretical,
            actual_usage: actual,
            variance: variance,
            variance_percentage: variancePercentage,
            cost_impact: costImpact
          });
        }
      });

      // Sort by absolute variance percentage (highest first)
      varianceItems.sort((a, b) => Math.abs(b.variance_percentage) - Math.abs(a.variance_percentage));

      setVarianceData(varianceItems);

    } catch (error: any) {
      console.error('Error fetching variance data:', error);
      toast({
        title: "Error loading variance analysis",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading variance analysis...</p>
      </div>
    );
  }

  if (varianceData.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No variance data available.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Ensure you have both POS sales and inventory transactions for the last 7 days.
        </p>
      </div>
    );
  }

  const totalCostImpact = varianceData.reduce((sum, item) => sum + item.cost_impact, 0);
  const significantVariances = varianceData.filter(item => Math.abs(item.variance_percentage) > 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Total Cost Impact</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${totalCostImpact >= 0 ? 'text-red-600' : 'text-green-600'}`}>
              ${Math.abs(totalCostImpact).toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground">
              {totalCostImpact >= 0 ? 'Over usage' : 'Under usage'} (7 days)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Significant Variances</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">
              {significantVariances.length}
            </p>
            <p className="text-sm text-muted-foreground">
              Items &gt;10% variance
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Items Tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">
              {varianceData.length}
            </p>
            <p className="text-sm text-muted-foreground">
              Products analyzed
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Variance Details</h3>
        
        {varianceData.slice(0, 10).map((item) => {
          const isOverUsage = item.variance > 0;
          const isSignificant = Math.abs(item.variance_percentage) > 10;
          
          return (
            <div key={item.product_name} className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{item.product_name}</h4>
                  {isSignificant && (
                    <Badge variant={isOverUsage ? "destructive" : "secondary"}>
                      {Math.abs(item.variance_percentage).toFixed(1)}% variance
                    </Badge>
                  )}
                </div>
                <div className="text-right">
                  <p className={`font-medium ${isOverUsage ? 'text-red-600' : 'text-green-600'}`}>
                    ${item.cost_impact.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">cost impact</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Theoretical Usage</p>
                  <p className="font-medium">{item.theoretical_usage.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Actual Usage</p>
                  <p className="font-medium">{item.actual_usage.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Variance</p>
                  <p className={`font-medium ${isOverUsage ? 'text-red-600' : 'text-green-600'}`}>
                    {isOverUsage ? '+' : ''}{item.variance.toFixed(2)} 
                    ({item.variance_percentage.toFixed(1)}%)
                  </p>
                </div>
              </div>

              {isSignificant && (
                <div className="mt-3 p-2 bg-muted rounded">
                  <p className="text-xs text-muted-foreground">
                    <strong>Investigation needed:</strong> This variance suggests potential portion control issues, 
                    waste, theft, or inaccurate recipes. Review preparation procedures and inventory handling.
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {varianceData.length > 10 && (
          <p className="text-sm text-muted-foreground text-center">
            Showing top 10 variances of {varianceData.length} items
          </p>
        )}
      </div>
    </div>
  );
};