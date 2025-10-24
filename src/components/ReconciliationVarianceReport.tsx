import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricIcon } from '@/components/MetricIcon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  TrendingDown, 
  TrendingUp, 
  AlertTriangle, 
  Target, 
  Download, 
  Calendar,
  DollarSign,
  Package,
  BarChart3,
  LineChart as LineChartIcon,
  PieChart,
  CheckCircle2,
  XCircle,
  Minus
} from 'lucide-react';
import { useReconciliationVariance } from '@/hooks/useReconciliationVariance';
import { LineChart, Line, BarChart, Bar, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { format } from 'date-fns';

interface ReconciliationVarianceReportProps {
  restaurantId: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export function ReconciliationVarianceReport({ restaurantId }: ReconciliationVarianceReportProps) {
  const { data, loading } = useReconciliationVariance(restaurantId);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

  const exportToCSV = () => {
    if (!data) return;

    const rows = [
      ['Variance Analysis Report'],
      ['Generated:', new Date().toISOString()],
      [],
      ['Summary'],
      ['Total Reconciliations:', data.summary.total_reconciliations],
      ['Total Shrinkage:', `$${data.summary.total_shrinkage.toFixed(2)}`],
      ['Avg Shrinkage per Count:', `$${data.summary.avg_shrinkage_per_count.toFixed(2)}`],
      ['Most Problematic Category:', data.summary.most_problematic_category],
      ['Improvement Rate:', `${data.summary.improvement_rate.toFixed(1)}%`],
      [],
      ['Top Variance Items'],
      ['Product', 'Category', 'Avg Variance', 'Trend', 'Total Impact'],
      ...data.topVariances.map(item => [
        item.product_name,
        item.category,
        item.avg_variance.toFixed(2),
        item.trend,
        `$${item.reconciliations.reduce((sum, r) => sum + Math.abs(r.variance_value), 0).toFixed(2)}`
      ]),
    ];

    const csv = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `variance-analysis-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          </CardHeader>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!data || data.trends.length === 0) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Variance Data Available</h3>
        <p className="text-muted-foreground mb-4">
          Complete at least one inventory reconciliation to see variance analysis
        </p>
      </div>
    );
  }

  const getTrendIcon = (trend: 'improving' | 'stable' | 'worsening') => {
    if (trend === 'improving') return <TrendingDown className="h-4 w-4 text-green-500" />;
    if (trend === 'worsening') return <TrendingUp className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-500" />;
  };

  const getTrendBadge = (trend: 'improving' | 'stable' | 'worsening') => {
    if (trend === 'improving') return <Badge className="bg-green-500">Improving</Badge>;
    if (trend === 'worsening') return <Badge variant="destructive">Worsening</Badge>;
    return <Badge variant="secondary">Stable</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <MetricIcon icon={BarChart3} variant="purple" />
              <div>
                <h2 className="text-2xl font-bold">Variance Intelligence Report</h2>
                <p className="text-muted-foreground">Advanced reconciliation analysis with actionable insights</p>
              </div>
            </div>
            <Button onClick={exportToCSV} variant="outline" className="w-full sm:w-auto" aria-label="Export variance report">
              <Download className="h-4 w-4 mr-2" />
              Export Report
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Key Insights */}
      {data.insights.length > 0 && (
        <div className="grid gap-4">
          {data.insights.map((insight, idx) => (
            <Card key={idx} className={
              insight.type === 'critical' ? 'border-red-500' :
              insight.type === 'warning' ? 'border-orange-500' : 
              'border-green-500'
            }>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  {insight.type === 'critical' && <XCircle className="h-6 w-6 text-red-500 flex-shrink-0" />}
                  {insight.type === 'warning' && <AlertTriangle className="h-6 w-6 text-orange-500 flex-shrink-0" />}
                  {insight.type === 'info' && <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold mb-1">{insight.title}</h3>
                    <p className="text-sm text-muted-foreground mb-2">{insight.description}</p>
                    <div className="flex flex-wrap gap-2 mb-2 text-xs">
                      <Badge variant="outline">{insight.affected_items} items affected</Badge>
                      {insight.estimated_impact > 0 && (
                        <Badge variant="outline">${insight.estimated_impact.toFixed(2)} impact</Badge>
                      )}
                    </div>
                    <p className="text-sm bg-muted p-2 rounded">
                      <strong>Action:</strong> {insight.recommendation}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Calendar} variant="blue" className="p-2" />
              Total Counts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.summary.total_reconciliations}</p>
            <p className="text-xs text-muted-foreground">reconciliations analyzed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={DollarSign} variant="red" className="p-2" />
              Total Shrinkage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">
              ${data.summary.total_shrinkage.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              ${data.summary.avg_shrinkage_per_count.toFixed(2)} avg per count
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Target} variant="amber" className="p-2" />
              Problem Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold truncate">{data.summary.most_problematic_category || 'N/A'}</p>
            <p className="text-xs text-muted-foreground">needs attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={TrendingDown} variant="emerald" className="p-2" />
              Improvement Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${data.summary.improvement_rate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {data.summary.improvement_rate >= 0 ? '+' : ''}{data.summary.improvement_rate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">variance reduction</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="grid w-full grid-cols-4" role="tablist">
          <TabsTrigger value="trends" aria-label="Variance trends over time">Trends</TabsTrigger>
          <TabsTrigger value="categories" aria-label="Variance by category">Categories</TabsTrigger>
          <TabsTrigger value="products" aria-label="Product-level variance">Products</TabsTrigger>
          <TabsTrigger value="timeline" aria-label="Historical timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Variance Rate Over Time</CardTitle>
              <CardDescription>Percentage of items with variance in each count</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                  />
                  <YAxis label={{ value: 'Variance Rate %', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                    formatter={(value: any) => [`${value.toFixed(1)}%`, 'Variance Rate']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="variance_rate" 
                    stroke="#ef4444" 
                    fill="#ef4444" 
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shrinkage Value Trend</CardTitle>
              <CardDescription>Total cost impact per reconciliation</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                  />
                  <YAxis label={{ value: 'Cost Impact ($)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                    formatter={(value: any) => [`$${value.toFixed(2)}`, 'Shrinkage']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="shrinkage_value" 
                    stroke="#f59e0b" 
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Variance by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RePieChart>
                    <Pie
                      data={data.categoryBreakdown}
                      dataKey="total_variance_value"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      label={(entry) => `${entry.category}: $${entry.total_variance_value.toFixed(0)}`}
                      labelLine={false}
                    >
                      {data.categoryBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => `$${value.toFixed(2)}`} />
                  </RePieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Category Impact</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.categoryBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="category" width={100} />
                    <Tooltip formatter={(value: any) => `$${value.toFixed(2)}`} />
                    <Bar dataKey="total_variance_value" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            {data.categoryBreakdown.map((cat, idx) => (
              <Card key={idx}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{cat.category}</CardTitle>
                    <Badge variant="destructive">${cat.total_variance_value.toFixed(2)}</Badge>
                  </div>
                  <CardDescription>{cat.items_count} items with variance</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Top Offenders:</p>
                    {cat.top_offenders.map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                        <span>{item.product_name}</span>
                        <span className="font-medium text-red-600">
                          ${Math.abs(item.variance_value).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products" className="space-y-4">
          <div className="grid gap-4">
            {data.topVariances.slice(0, 10).map((product, idx) => (
              <Card key={idx}>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{product.product_name}</CardTitle>
                      <CardDescription>{product.category}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {getTrendBadge(product.trend)}
                      <Badge variant="outline">
                        Avg: {product.avg_variance.toFixed(2)} units
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={product.reconciliations}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                      />
                      <YAxis />
                      <Tooltip 
                        labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="expected" 
                        stroke="#10b981" 
                        name="Expected"
                        dot={{ r: 3 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="actual" 
                        stroke="#ef4444" 
                        name="Actual"
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-4">
          {data.trends.map((trend, idx) => (
            <Card key={idx}>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">
                      {format(new Date(trend.date), 'MMMM dd, yyyy')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {trend.total_items} items counted • {trend.items_with_variance} with variance
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={trend.variance_rate > 20 ? 'destructive' : 'secondary'}>
                      {trend.variance_rate.toFixed(1)}% variance rate
                    </Badge>
                    <Badge variant="outline">
                      ${trend.shrinkage_value.toFixed(2)} impact
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
