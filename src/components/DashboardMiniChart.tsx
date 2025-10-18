import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, ResponsiveContainer, Tooltip, Area, AreaChart } from 'recharts';

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
  const previousValue = data.length > 1 ? data[data.length - 2].value : latestValue;
  const change = previousValue !== 0 ? ((latestValue - previousValue) / previousValue) * 100 : 0;

  return (
    <Card className="group transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 animate-fade-in bg-gradient-to-br from-card via-background to-muted/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-3xl font-bold tracking-tight">
            {suffix === '$' && '$'}
            {latestValue.toFixed(suffix === '%' ? 1 : 0)}
            {suffix === '%' && '%'}
          </div>
          {change !== 0 && (
            <span className={`text-xs font-medium ${change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {change > 0 ? '+' : ''}{change.toFixed(1)}%
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={70}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const value = typeof payload[0].value === 'number' ? payload[0].value : 0;
                  return (
                    <div className="bg-popover/95 backdrop-blur-xl border border-border/50 rounded-lg p-2.5 shadow-lg">
                      <p className="text-xs font-semibold">
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
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.5}
              fill={`url(#gradient-${title})`}
              animationDuration={1000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
