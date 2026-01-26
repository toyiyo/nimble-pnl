import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { format, parseISO } from 'date-fns';
import { BreakEvenData } from '@/types/operatingCosts';

interface SalesVsBreakEvenChartProps {
  data: BreakEvenData | null;
  isLoading: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function SalesVsBreakEvenChart({ data, isLoading }: SalesVsBreakEvenChartProps) {
  const navigate = useNavigate();

  const chartData = useMemo(() => {
    if (!data?.history) return [];
    
    return data.history.map((h) => ({
      date: h.date,
      dateLabel: format(parseISO(h.date), 'MMM d'),
      sales: h.sales,
      breakEven: h.breakEven,
      delta: h.delta,
      status: h.status,
    }));
  }, [data]);

  const handleBarClick = (entry: any) => {
    if (entry?.date) {
      // Navigate to reports page with that specific date selected for Daily P&L view
      navigate('/reports', { 
        state: { 
          selectedDate: entry.date,
          reportType: 'daily-pnl',
        } 
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sales vs Cost Reality</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No sales data available for the selected period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const breakEvenValue = data.dailyBreakEven;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Sales vs Cost Reality (Last {chartData.length} Days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 20, left: 20, bottom: 5 }}
              onClick={(e) => e?.activePayload?.[0]?.payload && handleBarClick(e.activePayload[0].payload)}
            >
              <XAxis 
                dataKey="dateLabel" 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis 
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value), 'Sales']}
                labelFormatter={(label) => label}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <ReferenceLine 
                y={breakEvenValue} 
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                label={{ 
                  value: `Break-even: ${formatCurrency(breakEvenValue)}`,
                  position: 'insideTopRight',
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 11,
                }}
              />
              <Bar 
                dataKey="sales" 
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              >
                {chartData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`}
                    fill={
                      entry.status === 'above' 
                        ? 'hsl(142.1, 76.2%, 36.3%)' // green-600
                        : entry.status === 'below'
                        ? 'hsl(0, 84.2%, 60.2%)' // red-500
                        : 'hsl(45.4, 93.4%, 47.5%)' // yellow-500
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
          <div className="text-center">
            <div className="text-2xl font-semibold text-primary">
              {data.daysAbove}
            </div>
            <div className="text-xs text-muted-foreground">Days above</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-destructive">
              {data.daysBelow}
            </div>
            <div className="text-xs text-muted-foreground">Days below</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-primary">
              {data.avgSurplus > 0 ? `+${formatCurrency(data.avgSurplus)}` : '-'}
            </div>
            <div className="text-xs text-muted-foreground">Avg surplus</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-destructive">
              {data.avgShortfall < 0 ? formatCurrency(data.avgShortfall) : '-'}
            </div>
            <div className="text-xs text-muted-foreground">Avg shortfall</div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-4">
          Click any bar to view detailed P&L reports for that date
        </p>
      </CardContent>
    </Card>
  );
}
