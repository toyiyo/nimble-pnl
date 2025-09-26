import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ConsumptionTrend } from '@/hooks/useRecipeAnalytics';

interface ConsumptionTrendsChartProps {
  data: ConsumptionTrend[];
}

export const ConsumptionTrendsChart: React.FC<ConsumptionTrendsChartProps> = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Group data by date and ingredient
    const groupedByDate: { [date: string]: { [ingredient: string]: { quantity: number; cost: number } } } = {};
    
    data.forEach(item => {
      if (!groupedByDate[item.date]) {
        groupedByDate[item.date] = {};
      }
      
      if (!groupedByDate[item.date][item.ingredient_name]) {
        groupedByDate[item.date][item.ingredient_name] = { quantity: 0, cost: 0 };
      }
      
      groupedByDate[item.date][item.ingredient_name].quantity += item.quantity_used;
      groupedByDate[item.date][item.ingredient_name].cost += item.cost;
    });

    // Get top 5 most used ingredients by total quantity
    const ingredientTotals: { [ingredient: string]: number } = {};
    data.forEach(item => {
      if (!ingredientTotals[item.ingredient_name]) {
        ingredientTotals[item.ingredient_name] = 0;
      }
      ingredientTotals[item.ingredient_name] += item.quantity_used;
    });

    const topIngredients = Object.entries(ingredientTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([ingredient]) => ingredient);

    // Convert to chart format
    const chartData = Object.entries(groupedByDate)
      .map(([date, ingredients]) => {
        const dataPoint: any = { 
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          fullDate: date
        };
        
        topIngredients.forEach(ingredient => {
          dataPoint[ingredient] = ingredients[ingredient]?.quantity || 0;
        });
        
        return dataPoint;
      })
      .sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());

    return chartData;
  }, [data]);

  const topIngredients = useMemo(() => {
    const ingredientTotals: { [ingredient: string]: number } = {};
    data.forEach(item => {
      if (!ingredientTotals[item.ingredient_name]) {
        ingredientTotals[item.ingredient_name] = 0;
      }
      ingredientTotals[item.ingredient_name] += item.quantity_used;
    });

    return Object.entries(ingredientTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([ingredient]) => ingredient);
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No consumption data available.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Process some POS sales to see ingredient consumption trends.
        </p>
      </div>
    );
  }

  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];

  return (
    <div className="space-y-4">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis 
              tick={{ fontSize: 12 }}
              label={{ value: 'Quantity Used', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px'
              }}
            />
            <Legend />
            {topIngredients.map((ingredient, index) => (
              <Line
                key={ingredient}
                type="monotone"
                dataKey={ingredient}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {topIngredients.map((ingredient, index) => {
          const totalUsed = data
            .filter(item => item.ingredient_name === ingredient)
            .reduce((sum, item) => sum + item.quantity_used, 0);
          
          const totalCost = data
            .filter(item => item.ingredient_name === ingredient)
            .reduce((sum, item) => sum + item.cost, 0);

          return (
            <div key={ingredient} className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: colors[index % colors.length] }}
                />
                <h4 className="font-medium text-sm">{ingredient}</h4>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Used (7d):</span>
                  <span className="font-medium">{totalUsed.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Cost:</span>
                  <span className="font-medium">${totalCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Daily Avg:</span>
                  <span className="font-medium">{(totalUsed / 7).toFixed(1)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};