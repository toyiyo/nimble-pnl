import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DailyPnL } from '@/hooks/useDailyPnL';

interface AggregatedPnLData {
  period: string;
  net_revenue: number;
  food_cost: number;
  labor_cost: number;
  prime_cost: number;
  gross_profit: number;
  food_cost_percentage: number;
  labor_cost_percentage: number;
  prime_cost_percentage: number;
  days_count: number;
  start_date: string;
  end_date: string;
}

interface PnLTrendChartProps {
  data: DailyPnL[] | AggregatedPnLData[];
  timeFrame: 'daily' | 'weekly' | 'monthly';
}

export const PnLTrendChart: React.FC<PnLTrendChartProps> = ({ data, timeFrame }) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No P&L data available for the selected period.</p>
      </div>
    );
  }

  // Format data for chart
  const chartData = data.map((item) => {
    let dateLabel = '';
    if (timeFrame === 'daily') {
      const date = new Date(item.date + 'T12:00:00Z');
      dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (timeFrame === 'weekly') {
      dateLabel = item.period || 'Week';
    } else {
      const [year, month] = item.period.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1);
      dateLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    return {
      date: dateLabel,
      'Food Cost %': item.food_cost_percentage,
      'Labor Cost %': item.labor_cost_percentage,
      'Prime Cost %': item.prime_cost_percentage,
      'Revenue': item.net_revenue,
    };
  }).reverse(); // Reverse to show chronological order

  const formatYAxis = (value: number) => {
    return `${value.toFixed(0)}%`;
  };

  const formatTooltip = (value: number, name: string) => {
    if (name === 'Revenue') {
      return [`$${value.toFixed(2)}`, name];
    }
    return [`${value.toFixed(1)}%`, name];
  };

  return (
    <div className="space-y-4">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              tickFormatter={formatYAxis}
              label={{ value: 'Percentage (%)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              formatter={formatTooltip}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px'
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="Food Cost %"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="Labor Cost %"
              stroke="#eab308"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="Prime Cost %"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
