import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ProfitabilityData } from '@/hooks/useRecipeAnalytics';

interface RecipeProfitabilityChartProps {
  data: ProfitabilityData | null;
}

export const RecipeProfitabilityChart: React.FC<RecipeProfitabilityChartProps> = ({ data }) => {
  if (!data || data.recipes.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No recipe profitability data available.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Add POS sales data and ensure recipes are mapped to see profitability analysis.
        </p>
      </div>
    );
  }

  // Sort recipes by margin for better visualization
  const sortedRecipes = [...data.recipes]
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10); // Show top 10 for readability

  // Color code based on margin performance
  const getBarColor = (margin: number) => {
    if (margin >= 70) return '#22c55e'; // Green for high margin (70%+)
    if (margin >= 50) return '#eab308'; // Yellow for medium margin (50-70%)
    return '#ef4444'; // Red for low margin (<50%)
  };

  const formatTooltip = (value: any, name: string, props: any) => {
    if (name === 'margin') {
      return [`${value.toFixed(1)}%`, 'Profit Margin'];
    }
    if (name === 'food_cost_percentage') {
      return [`${value.toFixed(1)}%`, 'Food Cost %'];
    }
    return [value, name];
  };

  const formatLabel = (label: string) => {
    // Truncate long recipe names for readability
    return label.length > 15 ? `${label.substring(0, 15)}...` : label;
  };

  return (
    <div className="space-y-4">
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sortedRecipes}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 60,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name" 
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
              tickFormatter={formatLabel}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              label={{ value: 'Margin %', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              formatter={formatTooltip}
              labelFormatter={(label) => `Recipe: ${label}`}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px'
              }}
            />
            <Bar dataKey="margin" radius={[4, 4, 0, 0]}>
              {sortedRecipes.map((recipe, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(recipe.margin)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedRecipes.slice(0, 6).map((recipe) => (
          <div key={recipe.id} className="p-3 border rounded-lg">
            <h4 className="font-medium text-sm mb-2">{recipe.name}</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost:</span>
                <span>${recipe.estimated_cost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price:</span>
                <span>${recipe.selling_price.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Margin:</span>
                <span className={`font-medium ${
                  recipe.margin >= 70 ? 'text-green-600' :
                  recipe.margin >= 50 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {recipe.margin.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Food Cost:</span>
                <span>{recipe.food_cost_percentage.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">Sales (30d):</span>
                <span>{recipe.total_quantity_sold} units</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {sortedRecipes.length < data.recipes.length && (
        <p className="text-sm text-muted-foreground text-center">
          Showing top {sortedRecipes.length} of {data.recipes.length} recipes
        </p>
      )}
    </div>
  );
};