import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PnLTrendChartProps {
  data: Array<{
    period: string;
    food_cost_percentage: number;
    labor_cost_percentage: number;
    prime_cost_percentage: number;
  }>;
  title?: string;
}

export function PnLTrendChart({ data, title = "P&L Cost Trends" }: PnLTrendChartProps) {
  const chartData = [...data].reverse().map(item => ({
    period: formatPeriod(item.period),
    'Food Cost %': Number(item.food_cost_percentage.toFixed(1)),
    'Labor Cost %': Number(item.labor_cost_percentage.toFixed(1)),
    'Prime Cost %': Number(item.prime_cost_percentage.toFixed(1)),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No data available for the selected period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="period" 
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis 
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                label={{ value: 'Percentage (%)', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))' } }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="Food Cost %" 
                stroke="hsl(var(--destructive))" 
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--destructive))' }}
              />
              <Line 
                type="monotone" 
                dataKey="Labor Cost %" 
                stroke="hsl(var(--warning))" 
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--warning))' }}
              />
              <Line 
                type="monotone" 
                dataKey="Prime Cost %" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function formatPeriod(period: string): string {
  if (period.includes('W')) {
    // Format: 2024-W01 -> W1
    const week = period.split('-W')[1];
    return `W${parseInt(week)}`;
  } else if (period.match(/^\d{4}-\d{2}$/)) {
    // Format: 2024-01 -> Jan '24
    const [year, month] = period.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} '${year.slice(2)}`;
  } else {
    // Daily format: 2024-01-15 -> 1/15
    const date = new Date(period + 'T12:00:00Z');
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  }
}
