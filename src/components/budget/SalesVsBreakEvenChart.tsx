import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="px-5 py-3 border-b border-border/40">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="p-5">
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  if (!data || chartData.length === 0) {
    return (
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="flex flex-col items-center justify-center py-12 text-center px-5">
          <p className="text-[14px] font-medium text-foreground">No break-even data yet</p>
          <p className="text-[13px] text-muted-foreground mt-1">Set up your budget to see daily sales vs break-even.</p>
        </div>
      </div>
    );
  }

  const breakEvenValue = data.dailyBreakEven;

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div>
          <h3 className="text-[14px] font-medium text-foreground">
            Sales vs Break-Even
          </h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">Last {chartData.length} days</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(142.1, 76.2%, 36.3%)' }} />
              <span className="text-[11px] text-muted-foreground">Above</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(0, 84.2%, 60.2%)' }} />
              <span className="text-[11px] text-muted-foreground">Below</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-5 pt-4 pb-2">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 12, left: 12, bottom: 4 }}
              onClick={(e) => e?.activePayload?.[0]?.payload && handleBarClick(e.activePayload[0].payload)}
            >
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value), 'Sales']}
                labelFormatter={(label) => label}
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              />
              <ReferenceLine
                y={breakEvenValue}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
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
                        ? 'hsl(142.1, 76.2%, 36.3%)'
                        : entry.status === 'below'
                        ? 'hsl(0, 84.2%, 60.2%)'
                        : 'hsl(45.4, 93.4%, 47.5%)'
                    }
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-px bg-border/40 border-t border-border/40">
        <div className="bg-background p-3 text-center">
          <p className="text-[16px] font-semibold text-green-600">{data.daysAbove}</p>
          <p className="text-[11px] text-muted-foreground">Days above</p>
        </div>
        <div className="bg-background p-3 text-center">
          <p className="text-[16px] font-semibold text-destructive">{data.daysBelow}</p>
          <p className="text-[11px] text-muted-foreground">Days below</p>
        </div>
        <div className="bg-background p-3 text-center">
          <p className="text-[14px] font-semibold text-green-600">
            {data.avgSurplus > 0 ? `+${formatCurrency(data.avgSurplus)}` : '-'}
          </p>
          <p className="text-[11px] text-muted-foreground">Avg surplus</p>
        </div>
        <div className="bg-background p-3 text-center">
          <p className="text-[14px] font-semibold text-destructive">
            {data.avgShortfall < 0 ? formatCurrency(data.avgShortfall) : '-'}
          </p>
          <p className="text-[11px] text-muted-foreground">Avg shortfall</p>
        </div>
      </div>

      <div className="px-5 py-2 border-t border-border/40">
        <p className="text-[11px] text-muted-foreground text-center">
          Click any bar to view P&L for that day
        </p>
      </div>
    </div>
  );
}
