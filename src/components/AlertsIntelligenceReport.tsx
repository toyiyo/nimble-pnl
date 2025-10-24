import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricIcon } from '@/components/MetricIcon';
import { useAlertsIntelligence } from '@/hooks/useAlertsIntelligence';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { ExportDropdown } from '@/components/financial-statements/shared/ExportDropdown';
import { generateTablePDF } from '@/utils/pdfExport';
import { exportToCSV as exportCSV, generateCSVFilename } from '@/utils/csvExport';
import { useToast } from '@/hooks/use-toast';
import { formatInventoryLevel } from '@/lib/inventoryDisplay';
import {
  AlertTriangle, AlertCircle, CheckCircle, Info,
  Package, Clock, TrendingUp, Shield, Calendar
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter
} from 'recharts';
import { format } from 'date-fns';

interface AlertsIntelligenceReportProps {
  restaurantId: string;
}

export const AlertsIntelligenceReport: React.FC<AlertsIntelligenceReportProps> = ({ restaurantId }) => {
  const { data, loading, refetch } = useAlertsIntelligence(restaurantId);
  const { selectedRestaurant } = useRestaurantContext();
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExportCSV = async () => {
    if (!data) return;
    setIsExporting(true);
    try {
      const csvData = data.alert_items.map(item => ({
        'Item': item.name,
        'Category': item.category,
        'Current Stock': item.current_stock,
        'Reorder Point': item.reorder_point,
        'Days Until Stockout': item.days_until_stockout != null ? String(item.days_until_stockout) : 'N/A',
        'Risk Level': item.stockout_risk,
        'Supplier': item.supplier_name ?? 'N/A',
      }));

      exportCSV({
        data: csvData,
        filename: generateCSVFilename('alerts_intelligence'),
      });

      toast({
        title: "Export Successful",
        description: "Alerts intelligence data exported to CSV",
      });
    } catch (error) {
      console.error("Error exporting CSV:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export alerts data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (!data) return;
    setIsExporting(true);
    try {
      const columns = ["Item", "Category", "Current Stock", "Reorder Point", "Days Until Stockout", "Risk Level", "Supplier"];
      const rows = data.alert_items.map(item => [
        item.name,
        item.category,
        item.current_stock.toString(),
        item.reorder_point != null ? String(item.reorder_point) : 'N/A',
        item.days_until_stockout != null ? String(item.days_until_stockout) : 'N/A',
        item.stockout_risk,
        item.supplier_name ?? 'N/A',
      ]);

      generateTablePDF({
        title: "Alerts Intelligence Report",
        restaurantName: selectedRestaurant?.restaurant?.name ?? 'Restaurant',
        columns,
        rows,
        filename: generateCSVFilename('alerts_intelligence').replace('.csv', '.pdf'),
      });

      toast({
        title: "Export Successful",
        description: "Alerts intelligence report exported to PDF",
      });
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export alerts report",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="space-y-4" role="status" aria-live="polite">
            <Skeleton className="h-12 w-3/4 mx-auto" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.alert_items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <CheckCircle className="h-12 w-12 mx-auto text-green-600 mb-4" />
            <p className="text-lg font-medium">All Inventory Levels Healthy!</p>
            <p className="text-sm text-muted-foreground mt-2">
              No items require immediate attention.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'success': return <CheckCircle className="h-5 w-5 text-green-600" />;
      default: return <Info className="h-5 w-5 text-blue-600" />;
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical': return 'text-destructive';
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      default: return 'text-green-600';
    }
  };

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MetricIcon icon={AlertTriangle} variant="red" />
              <div>
                <CardTitle className="text-2xl">
                  Alerts Intelligence Report
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Predictive inventory alerts and restocking optimization
                </p>
              </div>
            </div>
            <ExportDropdown 
              onExportCSV={handleExportCSV}
              onExportPDF={handleExportPDF}
              isExporting={isExporting}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Key Insights */}
      {data.insights.length > 0 && (
        <div className="space-y-3">
          {data.insights.slice(0, 3).map(insight => (
            <Card key={insight.id} className={`border-l-4 ${
              insight.type === 'critical' ? 'border-l-destructive' :
              insight.type === 'warning' ? 'border-l-yellow-600' :
              insight.type === 'success' ? 'border-l-green-600' : 'border-l-blue-600'
            }`}>
              <CardContent className="pt-4">
                <div className="flex gap-3">
                  {getInsightIcon(insight.type)}
                  <div className="flex-1 space-y-2">
                    <h4 className="font-semibold">{insight.title}</h4>
                    <p className="text-sm text-muted-foreground">{insight.description}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {insight.affected_items.slice(0, 3).map(item => (
                        <Badge key={item} variant="secondary">{item}</Badge>
                      ))}
                      {insight.affected_items.length > 3 && (
                        <Badge variant="outline">+{insight.affected_items.length - 3} more</Badge>
                      )}
                    </div>
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium">💡 Action Required:</p>
                      <p className="text-sm text-muted-foreground">{insight.recommendation}</p>
                      {insight.estimated_impact > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Potential cost to recover: ${insight.estimated_impact.toFixed(0)}
                        </p>
                      )}
                    </div>
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
              <MetricIcon icon={AlertTriangle} variant="red" className="p-2" />
              Total Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.summary.total_alerts}</div>
            <p className="text-xs text-muted-foreground">
              {data.summary.critical_alerts} critical
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Package} variant="amber" className="p-2" />
              Stockouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${data.summary.stockout_items > 0 ? 'text-destructive' : 'text-green-600'}`}>
              {data.summary.stockout_items}
            </div>
            <p className="text-xs text-muted-foreground">
              Items out of stock
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Clock} variant="blue" className="p-2" />
              Avg Runway
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {data.summary.avg_days_until_stockout.toFixed(0)}d
            </div>
            <p className="text-xs text-muted-foreground">
              Until stockout
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={TrendingUp} variant="emerald" className="p-2" />
              Par Efficiency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {data.summary.par_level_efficiency.toFixed(0)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Within par levels
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analysis Tabs */}
      <Tabs defaultValue="critical" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6" role="tablist">
          <TabsTrigger value="critical" aria-label="Critical items requiring attention">Critical</TabsTrigger>
          <TabsTrigger value="timeline" aria-label="Stockout timeline projection">Timeline</TabsTrigger>
          <TabsTrigger value="suppliers" aria-label="Supplier analysis">Suppliers</TabsTrigger>
          <TabsTrigger value="history" aria-label="Alert history">History</TabsTrigger>
          <TabsTrigger value="benchmarks" aria-label="Industry benchmarks">Benchmarks</TabsTrigger>
          <TabsTrigger value="forecast" aria-label="Consumption forecast">Forecast</TabsTrigger>
        </TabsList>

        {/* Critical Items Tab */}
        <TabsContent value="critical" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Risk Level Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Critical', value: data.alert_items.filter(i => i.stockout_risk === 'critical').length },
                        { name: 'High', value: data.alert_items.filter(i => i.stockout_risk === 'high').length },
                        { name: 'Medium', value: data.alert_items.filter(i => i.stockout_risk === 'medium').length },
                        { name: 'Low', value: data.alert_items.filter(i => i.stockout_risk === 'low').length }
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.name}: ${entry.value}`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#ef4444" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#3b82f6" />
                      <Cell fill="#10b981" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3">
            {data.alert_items
              .sort((a, b) => {
                const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                return riskOrder[a.stockout_risk] - riskOrder[b.stockout_risk];
              })
              .map(item => (
                <Card key={item.id} className="border-l-4 border-l-destructive">
                  <CardContent className="pt-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold">{item.name}</h4>
                          <Badge variant={getRiskBadge(item.stockout_risk)}>
                            {item.stockout_risk.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                          <div>Category: {item.category}</div>
                          <div>Supplier: {item.supplier_name}</div>
                          <div>Current: {formatInventoryLevel(item.current_stock, item, { showBothUnits: false })}</div>
                          <div>Reorder at: {formatInventoryLevel(item.reorder_point, item, { showBothUnits: false })}</div>
                          <div className={getRiskColor(item.stockout_risk)}>
                            Days left: {item.days_until_stockout}
                          </div>
                          <div>Usage: {item.avg_consumption_rate.toFixed(2)}/day</div>
                        </div>
                      </div>
                      <div className="text-right sm:text-left">
                        <p className="text-xs text-muted-foreground">Reorder Cost</p>
                        <p className="text-lg font-bold">
                          ${(item.par_level_max * item.cost_per_unit).toFixed(0)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stockout Timeline Projection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="days_until_stockout" 
                      name="Days Until Stockout"
                      label={{ value: 'Days Until Stockout', position: 'insideBottom', offset: -10 }}
                    />
                    <YAxis 
                      dataKey="cost_per_unit" 
                      name="Cost per Unit"
                      label={{ value: 'Cost per Unit ($)', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip 
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-card p-3 border rounded-lg shadow-lg">
                              <p className="font-medium">{data.name}</p>
                              <p className="text-sm text-muted-foreground">
                                Days left: {data.days_until_stockout}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Cost: ${data.cost_per_unit.toFixed(2)}
                              </p>
                              <Badge variant={getRiskBadge(data.stockout_risk)} className="mt-1">
                                {data.stockout_risk}
                              </Badge>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Scatter 
                      name="Items" 
                      data={data.alert_items.slice(0, 30)}
                      fill="#3b82f6"
                    >
                      {data.alert_items.slice(0, 30).map((item, index) => (
                        <Cell 
                          key={`cell-${index}`}
                          fill={
                            item.stockout_risk === 'critical' ? '#ef4444' :
                            item.stockout_risk === 'high' ? '#f59e0b' :
                            item.stockout_risk === 'medium' ? '#3b82f6' : '#10b981'
                          }
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Days Until Stockout by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={Object.entries(
                      data.alert_items.reduce((acc, item) => {
                        if (!acc[item.category]) {
                          acc[item.category] = { category: item.category, avg_days: 0, count: 0 };
                        }
                        acc[item.category].avg_days += item.days_until_stockout;
                        acc[item.category].count += 1;
                        return acc;
                      }, {} as Record<string, { category: string; avg_days: number; count: number }>)
                    ).map(([_, data]) => ({
                      category: data.category,
                      avg_days: data.avg_days / data.count
                    }))}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="category" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => `${value.toFixed(1)} days`} />
                    <Bar dataKey="avg_days" fill="#3b82f6" name="Avg Days Until Stockout" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Suppliers Tab */}
        <TabsContent value="suppliers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Supplier Reliability Scores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.supplier_performance} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="supplier_name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="reliability_score" name="Reliability Score">
                      {data.supplier_performance.map((supplier, index) => (
                        <Cell 
                          key={`cell-${index}`}
                          fill={supplier.reliability_score >= 85 ? '#10b981' : supplier.reliability_score >= 70 ? '#f59e0b' : '#ef4444'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.supplier_performance.map(supplier => (
              <Card key={supplier.supplier_name}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    {supplier.supplier_name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Items</span>
                    <span className="font-medium">{supplier.total_items}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Critical Items</span>
                    <span className={`font-medium ${supplier.critical_items > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {supplier.critical_items}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Days Runway</span>
                    <span className="font-medium">{supplier.avg_days_until_stockout.toFixed(0)} days</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Reliability Score</span>
                    <span className={`font-bold ${supplier.reliability_score >= 85 ? 'text-green-600' : supplier.reliability_score >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {supplier.reliability_score.toFixed(0)}/100
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          {data.stockout_history.length > 0 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Stockout Impact Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.stockout_history.slice(0, 10)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="product_name" type="category" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                        <Bar dataKey="estimated_lost_sales" fill="#ef4444" name="Estimated Lost Sales" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-3">
                {data.stockout_history.map(item => (
                  <Card key={item.product_name}>
                    <CardContent className="pt-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex-1">
                          <h4 className="font-semibold mb-2">{item.product_name}</h4>
                          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                            <div>Stockouts: {item.stockout_count}</div>
                            <div>Days Out: {item.total_days_out}</div>
                            <div>Last Stockout: {item.last_stockout}</div>
                            <div className="text-red-600">
                              Lost Sales: ${item.estimated_lost_sales.toFixed(0)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-8">
                <div className="text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-green-600 mb-4" />
                  <p className="text-muted-foreground">No stockout history in the last 60 days</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Benchmarks Tab */}
        <TabsContent value="benchmarks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance vs. Industry Standards</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={data.benchmarks}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" />
                    <PolarRadiusAxis />
                    <Radar name="Current" dataKey="current_value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                    <Radar name="Target" dataKey="target_value" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.benchmarks.map(benchmark => (
              <Card key={benchmark.metric}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{benchmark.metric}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Current</span>
                    <span className="text-lg font-bold">{benchmark.current_value.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Target</span>
                    <span className="text-lg">{benchmark.target_value.toFixed(1)}</span>
                  </div>
                  <div className="pt-2 border-t">
                    <Badge variant={benchmark.performance === 'above' ? 'default' : benchmark.performance === 'at' ? 'secondary' : 'destructive'}>
                      {benchmark.performance === 'above' ? 'Above Target' : benchmark.performance === 'at' ? 'At Target' : 'Below Target'}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-2">
                      Gap: {benchmark.gap > 0 ? '+' : ''}{benchmark.gap.toFixed(1)} points
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Forecast Tab */}
        <TabsContent value="forecast" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>This Week's Action Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Items at Risk This Week</p>
                    <p className="text-3xl font-bold">{data.predictions.items_at_risk_this_week.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Require immediate attention
                    </p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Est. Reorder Cost</p>
                    <p className="text-3xl font-bold">${data.predictions.estimated_reorder_cost.toFixed(0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      To maintain stock levels
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-3">Priority Reorder List:</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {data.predictions.items_at_risk_this_week.slice(0, 10).map(item => (
                      <div key={item} className="flex items-center gap-2 p-2 border rounded-lg">
                        <Calendar className="h-4 w-4 text-red-600" />
                        <span className="text-sm flex-1">{item}</span>
                        {data.predictions.optimal_reorder_timing[item] && (
                          <Badge variant="outline" className="text-xs">
                            {data.predictions.optimal_reorder_timing[item]}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Optimal Reorder Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(data.predictions.optimal_reorder_timing).slice(0, 10).map(([item, date]) => (
                  <div key={item} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium text-sm">{item}</p>
                        <p className="text-xs text-muted-foreground">Order before this date</p>
                      </div>
                    </div>
                    <Badge variant="outline">{date}</Badge>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4 text-center">
                Confidence level: {(data.predictions.confidence * 100).toFixed(0)}%
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
