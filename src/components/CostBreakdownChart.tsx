import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CostBreakdownChartProps {
  data: {
    food_cost: number;
    labor_cost: number;
    net_revenue: number;
  };
  title?: string;
}

export function CostBreakdownChart({ data, title = "Cost Breakdown" }: CostBreakdownChartProps) {
  const totalCosts = data.food_cost + data.labor_cost;
  
  if (totalCosts === 0 || data.net_revenue === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No cost data available for the selected period
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = [
    { 
      name: 'Food Cost', 
      value: data.food_cost,
      percentage: (data.food_cost / data.net_revenue) * 100
    },
    { 
      name: 'Labor Cost', 
      value: data.labor_cost,
      percentage: (data.labor_cost / data.net_revenue) * 100
    },
  ];

  const COLORS = {
    'Food Cost': 'hsl(var(--destructive))',
    'Labor Cost': 'hsl(var(--warning))',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percentage }) => `${name}: ${percentage.toFixed(1)}%`}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => `$${value.toFixed(2)}`}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="p-4 border rounded-lg">
            <p className="text-sm text-muted-foreground">Food Cost</p>
            <p className="text-2xl font-bold">${data.food_cost.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              {data.net_revenue > 0 ? `${((data.food_cost / data.net_revenue) * 100).toFixed(1)}% of revenue` : ''}
            </p>
          </div>
          <div className="p-4 border rounded-lg">
            <p className="text-sm text-muted-foreground">Labor Cost</p>
            <p className="text-2xl font-bold">${data.labor_cost.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              {data.net_revenue > 0 ? `${((data.labor_cost / data.net_revenue) * 100).toFixed(1)}% of revenue` : ''}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
