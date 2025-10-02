import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface CostBreakdownChartProps {
  foodCost: number;
  laborCost: number;
  otherCosts?: number;
}

export const CostBreakdownChart: React.FC<CostBreakdownChartProps> = ({ 
  foodCost, 
  laborCost, 
  otherCosts = 0 
}) => {
  const data = [
    { name: 'Food Cost', value: foodCost, color: '#ef4444' },
    { name: 'Labor Cost', value: laborCost, color: '#eab308' },
  ];

  if (otherCosts > 0) {
    data.push({ name: 'Other Costs', value: otherCosts, color: '#6b7280' });
  }

  const total = foodCost + laborCost + otherCosts;

  if (total === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No cost data available.</p>
      </div>
    );
  }

  const formatTooltip = (value: number) => {
    const percentage = ((value / total) * 100).toFixed(1);
    return [`$${value.toFixed(2)} (${percentage}%)`, ''];
  };

  const renderLabel = (entry: { value: number }) => {
    const percentage = ((entry.value / total) * 100).toFixed(1);
    return `${percentage}%`;
  };

  return (
    <div className="space-y-4">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderLabel}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              formatter={formatTooltip}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px'
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {data.map((item) => (
          <div key={item.name} className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: item.color }}
              />
              <h4 className="font-medium text-sm">{item.name}</h4>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-medium">${item.value.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Percentage:</span>
                <span className="font-medium">
                  {((item.value / total) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
