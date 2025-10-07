import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConsumptionIntelligence } from '@/hooks/useConsumptionIntelligence';
import {
  TrendingUp, TrendingDown, Minus, Download, AlertCircle,
  CheckCircle, Info, Activity, Target, Zap, Award, AlertTriangle
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart
} from 'recharts';
import { format } from 'date-fns';

interface ConsumptionIntelligenceReportProps {
  restaurantId: string;
}

export const ConsumptionIntelligenceReport: React.FC<ConsumptionIntelligenceReportProps> = ({ restaurantId }) => {
  const { data, loading, refetch } = useConsumptionIntelligence(restaurantId);

  const exportToCSV = () => {
    if (!data) return;

    const csvData = [
      ['Consumption Intelligence Report'],
      ['Generated:', new Date().toLocaleDateString()],
      [''],
      ['Ingredient', 'Category', 'Total Usage', 'Total Cost', 'Avg Daily Usage', 'Waste %', 'Efficiency Score', 'Trend'],
      ...data.ingredient_patterns.map(i => [
        i.ingredient_name,
        i.category,
        i.total_usage.toFixed(2),
        i.total_cost.toFixed(2),
        i.avg_daily_usage.toFixed(2),
        i.waste_percentage.toFixed(1),
        i.efficiency_score.toFixed(0),
        i.trend
      ])
    ];

    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consumption-intelligence-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading consumption intelligence...</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.ingredient_patterns.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <p className="text-muted-foreground">No consumption data available</p>
            <p className="text-sm text-muted-foreground mt-2">
              Start tracking inventory usage to see consumption trends and insights.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing': return <TrendingUp className="h-4 w-4 text-red-600" />;
      case 'decreasing': return <TrendingDown className="h-4 w-4 text-green-600" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'success': return <CheckCircle className="h-5 w-5 text-green-600" />;
      default: return <Info className="h-5 w-5 text-blue-600" />;
    }
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Activity className="h-6 w-6" />
                Consumption Intelligence Report
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Advanced analytics for ingredient usage optimization
              </p>
            </div>
            <Button onClick={exportToCSV} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
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
                      <p className="text-sm font-medium">💡 Recommendation:</p>
                      <p className="text-sm text-muted-foreground">{insight.recommendation}</p>
                      {insight.estimated_impact > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Potential savings: ${insight.estimated_impact.toFixed(0)}/month
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
              <Target className="h-4 w-4" />
              Total Cost (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${data.summary.total_consumption_cost.toFixed(0)}</div>
            <p className="text-xs text-muted-foreground">
              ${data.summary.avg_daily_cost.toFixed(2)}/day avg
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Waste Level
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${data.summary.waste_percentage > 10 ? 'text-red-600' : data.summary.waste_percentage > 5 ? 'text-yellow-600' : 'text-green-600'}`}>
              {data.summary.waste_percentage.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Target: &lt;5%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Efficiency Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {data.summary.efficiency_score.toFixed(0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Out of 100 points
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="h-4 w-4" />
              Items Tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.summary.total_items_tracked}</div>
            <p className="text-xs text-muted-foreground">
              Active ingredients
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analysis Tabs */}
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="efficiency">Efficiency</TabsTrigger>
          <TabsTrigger value="seasonal">Seasonal</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Daily Consumption Trends (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily_trends.slice(0, 30).reverse()}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                    />
                    <YAxis label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
                    <Tooltip 
                      labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cost']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="cost" 
                      stroke="#3b82f6" 
                      fillOpacity={1} 
                      fill="url(#colorCost)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Cost Drivers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.ingredient_patterns.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="ingredient_name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Bar dataKey="total_cost" fill="#10b981" name="Total Cost (30d)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Patterns Tab */}
        <TabsContent value="patterns" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Usage Trends Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Increasing', value: data.ingredient_patterns.filter(i => i.trend === 'increasing').length },
                          { name: 'Stable', value: data.ingredient_patterns.filter(i => i.trend === 'stable').length },
                          { name: 'Decreasing', value: data.ingredient_patterns.filter(i => i.trend === 'decreasing').length }
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
                        <Cell fill="#3b82f6" />
                        <Cell fill="#10b981" />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Category Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={Object.entries(
                          data.ingredient_patterns.reduce((acc, i) => {
                            acc[i.category] = (acc[i.category] || 0) + i.total_cost;
                            return acc;
                          }, {} as Record<string, number>)
                        ).map(([name, value]) => ({ name, value }))}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry) => `${entry.name}: $${entry.value.toFixed(0)}`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {Object.keys(data.ingredient_patterns.reduce((acc, i) => {
                          acc[i.category] = true;
                          return acc;
                        }, {} as Record<string, boolean>)).map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.ingredient_patterns.slice(0, 6).map(item => (
              <Card key={item.ingredient_name}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{item.ingredient_name}</CardTitle>
                    {getTrendIcon(item.trend)}
                  </div>
                  <Badge variant="secondary" className="w-fit">{item.category}</Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Cost</span>
                    <span className="font-medium">${item.total_cost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Daily Usage</span>
                    <span className="font-medium">{item.avg_daily_usage.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Waste Level</span>
                    <span className={`font-medium ${item.waste_percentage > 10 ? 'text-red-600' : item.waste_percentage > 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                      {item.waste_percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Usage Variance</span>
                    <span className="font-medium">{item.usage_variance.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Efficiency Score</span>
                    <span className="font-bold text-primary">{item.efficiency_score.toFixed(0)}/100</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Efficiency Tab */}
        <TabsContent value="efficiency" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Efficiency Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.ingredient_patterns.slice(0, 12)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="ingredient_name" 
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="efficiency_score" name="Efficiency Score">
                      {data.ingredient_patterns.slice(0, 12).map((item, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={item.efficiency_score >= 75 ? '#10b981' : item.efficiency_score >= 60 ? '#f59e0b' : '#ef4444'} 
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex gap-4 justify-center text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-600" />
                  <span>Excellent (75+)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-600" />
                  <span>Good (60-74)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-600" />
                  <span>Needs Work (&lt;60)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Performers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...data.ingredient_patterns]
                    .sort((a, b) => b.efficiency_score - a.efficiency_score)
                    .slice(0, 5)
                    .map((item, index) => (
                      <div key={item.ingredient_name} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                          {index + 1}
                        </Badge>
                        <span className="text-sm flex-1 truncate">{item.ingredient_name}</span>
                        <span className="text-sm font-bold text-green-600">{item.efficiency_score.toFixed(0)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lowest Waste</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...data.ingredient_patterns]
                    .sort((a, b) => a.waste_percentage - b.waste_percentage)
                    .slice(0, 5)
                    .map((item, index) => (
                      <div key={item.ingredient_name} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                          {index + 1}
                        </Badge>
                        <span className="text-sm flex-1 truncate">{item.ingredient_name}</span>
                        <span className="text-sm font-bold text-green-600">{item.waste_percentage.toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Most Consistent</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...data.ingredient_patterns]
                    .sort((a, b) => a.usage_variance - b.usage_variance)
                    .slice(0, 5)
                    .map((item, index) => (
                      <div key={item.ingredient_name} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                          {index + 1}
                        </Badge>
                        <span className="text-sm flex-1 truncate">{item.ingredient_name}</span>
                        <span className="text-sm font-bold">{(100 - item.usage_variance).toFixed(0)}%</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Seasonal Tab */}
        <TabsContent value="seasonal" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Day of Week Patterns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.seasonal_patterns}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day_of_week" />
                    <YAxis yAxisId="left" label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: 'Transactions', angle: 90, position: 'insideRight' }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="avg_cost" fill="#10b981" name="Avg Cost" />
                    <Line yAxisId="right" type="monotone" dataKey="transaction_count" stroke="#3b82f6" strokeWidth={2} name="Transactions" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {data.seasonal_patterns.map(day => (
              <Card key={day.day_of_week}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{day.day_of_week.substring(0, 3)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">Cost:</span>
                    <span className="font-bold ml-1">${day.avg_cost.toFixed(0)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trans:</span>
                    <span className="font-medium ml-1">{day.transaction_count}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Benchmarks Tab */}
        <TabsContent value="benchmarks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance vs. Targets</CardTitle>
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
              <CardTitle>Next Week Predictions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Projected Cost</p>
                    <p className="text-3xl font-bold">${data.predictions.next_week_cost.toFixed(0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Confidence: {(data.predictions.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Projected Usage</p>
                    <p className="text-3xl font-bold">{data.predictions.next_week_usage.toFixed(0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">units</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-3">High Risk Items:</p>
                  {data.predictions.high_risk_items.length > 0 ? (
                    <div className="space-y-2">
                      {data.predictions.high_risk_items.map(item => (
                        <div key={item} className="flex items-center gap-2 p-2 border rounded-lg">
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          <span className="text-sm">{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No high-risk items identified</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recommendations for Next Week</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="p-3 border rounded-lg">
                  <p className="font-medium text-sm">1. Monitor High-Risk Items</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Pay special attention to items showing increasing trends and high waste. Review portion sizes and storage conditions.
                  </p>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="font-medium text-sm">2. Optimize Ordering Schedule</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Based on seasonal patterns, adjust order quantities for peak days (typically weekends). Reduce orders for low-usage days.
                  </p>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="font-medium text-sm">3. Implement FIFO System</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    For items with high waste percentages, ensure First In, First Out rotation is strictly followed to minimize spoilage.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
