import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

interface DashboardMiniChartProps {
  title: string;
  description: string;
  data: Array<{ date: string; value: number }>;
  color?: string;
  suffix?: string;
}

export function DashboardMiniChart({ 
  title, 
  description, 
  data, 
  color = '#3b82f6',
  suffix = ''
}: DashboardMiniChartProps) {
  const latestValue = data.length > 0 ? data[data.length - 1].value : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-2">
          {suffix === '$' && '$'}
          {latestValue.toFixed(suffix === '%' ? 1 : 0)}
          {suffix === '%' && '%'}
        </div>
        <ResponsiveContainer width="100%" height={60}>
          <LineChart data={data}>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const value = typeof payload[0].value === 'number' ? payload[0].value : 0;
                  return (
                    <div className="bg-popover border rounded-lg p-2 shadow-md">
                      <p className="text-xs font-medium">
                        {suffix === '$' && '$'}
                        {value.toFixed(suffix === '%' ? 1 : 0)}
                        {suffix === '%' && '%'}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
