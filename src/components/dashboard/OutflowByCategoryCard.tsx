import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOutflowByCategory } from '@/hooks/useOutflowByCategory';
import { DollarSign, TrendingUp, ArrowRight, AlertCircle } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useNavigate } from 'react-router-dom';

interface OutflowByCategoryCardProps {
  startDate: Date;
  endDate: Date;
  periodLabel: string;
}

// Using a mix of semantic chart colors and fallback colors for 12 categories
const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  '#3b82f6', // blue fallback
  '#8b5cf6', // purple fallback
  '#ec4899', // pink fallback
  '#f59e0b', // amber fallback
  '#10b981', // emerald fallback
  '#06b6d4', // cyan fallback
  '#64748b', // slate fallback
];

export const OutflowByCategoryCard = ({ startDate, endDate, periodLabel }: OutflowByCategoryCardProps) => {
  const { data, isLoading, isError, error, refetch } = useOutflowByCategory(startDate, endDate);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 to-transparent border-destructive/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Failed to Load Expense Data</CardTitle>
              <CardDescription>Cash outflows • {periodLabel}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">Unable to load expense categories</h3>
          <p className="text-muted-foreground mb-4">
            {error?.message || 'An error occurred while fetching your expense data.'}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Check your connection or try refreshing the data.
          </p>
          <Button onClick={() => refetch()} variant="outline">
            <TrendingUp className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.categories.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-muted/50 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl">Where Your Money Went</CardTitle>
              <CardDescription>Cash outflows • {periodLabel}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No outflows this period</h3>
          <p className="text-muted-foreground">Connect your bank or upload transactions to see spending insights.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.categories.slice(0, 8).map((cat, idx) => ({
    name: cat.category,
    value: cat.amount,
    percentage: cat.percentage,
    color: COLORS[idx % COLORS.length],
  }));

  const handleCategoryClick = (category: string) => {
    navigate('/banking', { state: { filterCategory: category } });
  };

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DollarSign className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Where Your Money Went
              </CardTitle>
              <CardDescription>Cash outflows • {periodLabel}</CardDescription>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              ${data.totalOutflows.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-sm text-muted-foreground">Total Outflows</div>
            {data.pendingOutflows > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                Includes ${data.pendingOutflows.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} pending
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          {data.pendingOutflows > 0 && (
            <Badge className="bg-gradient-to-r from-orange-500 to-amber-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              ${data.pendingOutflows.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Pending Checks/ACH
            </Badge>
          )}
          {data.uncategorizedPercentage > 5 && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
              <AlertCircle className="w-3 h-3 mr-1" />
              {data.uncategorizedPercentage.toFixed(0)}% Uncategorized
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Donut Chart */}
          <div className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-background border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">{data.name}</p>
                          <p className="text-sm text-muted-foreground">
                            ${data.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {data.percentage.toFixed(1)}% of total
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Category Table */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground mb-3">Category Breakdown</div>
            {data.categories.slice(0, 8).map((cat, idx) => (
              <button
                key={cat.category}
                onClick={() => handleCategoryClick(cat.category)}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-accent/50 transition-colors text-left group"
                aria-label={`View ${cat.category} transactions`}
              >
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <span className="text-sm font-medium truncate">{cat.category}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold">
                      ${cat.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {cat.percentage.toFixed(1)}%
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
            {data.categories.length > 8 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/banking')}
                className="w-full mt-2"
              >
                View All Categories
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Transfers between your accounts are excluded.
        </p>
      </CardContent>
    </Card>
  );
};
