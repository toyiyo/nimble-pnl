import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRecipeIntelligence } from '@/hooks/useRecipeIntelligence';
import { 
  TrendingUp, TrendingDown, Minus, Download, AlertCircle, 
  CheckCircle, Info, DollarSign, Target, Zap, Award
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Area, AreaChart, ComposedChart
} from 'recharts';
import { format } from 'date-fns';

interface RecipeIntelligenceReportProps {
  restaurantId: string;
}

export const RecipeIntelligenceReport: React.FC<RecipeIntelligenceReportProps> = ({ restaurantId }) => {
  const { data, loading, refetch } = useRecipeIntelligence(restaurantId);

  const exportToCSV = () => {
    if (!data) return;

    const csvData = [
      ['Recipe Performance Report'],
      ['Generated:', new Date().toLocaleDateString()],
      [''],
      ['Recipe Name', 'Margin %', 'Food Cost %', 'Revenue', 'Units Sold', 'Efficiency Score', 'Trend'],
      ...data.performance.map(r => [
        r.name,
        r.margin.toFixed(1),
        r.food_cost_percentage.toFixed(1),
        r.total_sales.toFixed(2),
        r.total_quantity_sold,
        r.efficiency_score.toFixed(0),
        r.trend
      ])
    ];

    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-intelligence-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading recipe intelligence...</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.performance.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <p className="text-muted-foreground">No recipe data available</p>
            <p className="text-sm text-muted-foreground mt-2">
              Add sales data and ensure recipes are mapped to POS items.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'down': return <TrendingDown className="h-4 w-4 text-red-600" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-destructive" />;
      case 'warning': return <AlertCircle className="h-5 w-5 text-yellow-600" />;
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
                <Award className="h-6 w-6" />
                Recipe Intelligence Report
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                AI-powered insights for recipe optimization
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
                      {insight.affected_recipes.slice(0, 3).map(recipe => (
                        <Link key={recipe} to="/recipes">
                          <Badge variant="secondary" className="hover:bg-accent cursor-pointer transition-colors">
                            {recipe}
                          </Badge>
                        </Link>
                      ))}
                      {insight.affected_recipes.length > 3 && (
                        <Badge variant="outline">+{insight.affected_recipes.length - 3} more</Badge>
                      )}
                    </div>
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium">💡 Recommendation:</p>
                      <p className="text-sm text-muted-foreground">{insight.recommendation}</p>
                      {insight.estimated_impact > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Potential impact: ${insight.estimated_impact.toFixed(0)}/month
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
              Active Recipes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.summary.active_recipes}</div>
            <p className="text-xs text-muted-foreground">
              of {data.summary.total_recipes} total recipes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Avg Margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {data.summary.average_margin.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Target: 65%
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
              {data.summary.average_efficiency_score.toFixed(0)}
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
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {data.summary.high_performers}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.summary.low_performers} need attention
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analysis Tabs */}
      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
          <TabsTrigger value="efficiency">Efficiency</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recipe Performance Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.performance.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis yAxisId="left" label={{ value: 'Revenue ($)', angle: -90, position: 'insideLeft' }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: 'Score', angle: 90, position: 'insideRight' }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="total_sales" fill="#10b981" name="Revenue" />
                    <Line yAxisId="right" type="monotone" dataKey="efficiency_score" stroke="#3b82f6" name="Efficiency" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="margin" stroke="#f59e0b" name="Margin %" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.performance.slice(0, 6).map(recipe => (
              <Card key={recipe.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <Link to="/recipes" className="hover:text-primary transition-colors">
                      <CardTitle className="text-base hover:underline cursor-pointer">{recipe.name}</CardTitle>
                    </Link>
                    {getTrendIcon(recipe.trend)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Efficiency Score</span>
                    <span className="font-bold text-primary">{recipe.efficiency_score.toFixed(0)}/100</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Margin</span>
                    <span className={`font-medium ${recipe.margin >= 60 ? 'text-green-600' : recipe.margin >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {recipe.margin.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Revenue (30d)</span>
                    <span className="font-medium">${recipe.total_sales.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Velocity</span>
                    <span className="font-medium">{recipe.velocity.toFixed(1)} units/day</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Food Cost</span>
                    <span className="font-medium">{recipe.food_cost_percentage.toFixed(1)}%</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Profitability Tab */}
        <TabsContent value="profitability" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Revenue Contribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.performance.slice(0, 6)}
                        dataKey="total_sales"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={(entry) => `${entry.name}: $${entry.total_sales.toFixed(0)}`}
                      >
                        {data.performance.slice(0, 6).map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Profit per Recipe</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.performance.slice(0, 8)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                      <Bar dataKey="profit_contribution" fill="#10b981" name="Total Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Margin Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.performance.slice(0, 10).map(recipe => (
                  <div key={recipe.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <Link to="/recipes" className="font-medium hover:text-primary hover:underline transition-colors cursor-pointer">
                        {recipe.name}
                      </Link>
                      <span className={`font-bold ${recipe.margin >= 60 ? 'text-green-600' : recipe.margin >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {recipe.margin.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${recipe.margin >= 60 ? 'bg-green-600' : recipe.margin >= 50 ? 'bg-yellow-600' : 'bg-red-600'}`}
                        style={{ width: `${Math.min(recipe.margin, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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
                  <BarChart data={data.performance.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="efficiency_score" name="Efficiency Score">
                      {data.performance.slice(0, 10).map((recipe, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={recipe.efficiency_score >= 75 ? '#10b981' : recipe.efficiency_score >= 60 ? '#f59e0b' : '#ef4444'} 
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
                <CardTitle className="text-base">Top Efficiency Leaders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.performance.slice(0, 5).map((recipe, index) => (
                    <div key={recipe.id} className="flex items-center gap-2">
                      <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                        {index + 1}
                      </Badge>
                      <Link to="/recipes" className="text-sm flex-1 truncate hover:text-primary hover:underline transition-colors cursor-pointer">
                        {recipe.name}
                      </Link>
                      <span className="text-sm font-bold text-green-600">{recipe.efficiency_score.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fastest Moving</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...data.performance]
                    .sort((a, b) => b.velocity - a.velocity)
                    .slice(0, 5)
                    .map((recipe, index) => (
                      <div key={recipe.id} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                          {index + 1}
                        </Badge>
                        <Link to="/recipes" className="text-sm flex-1 truncate hover:text-primary hover:underline transition-colors cursor-pointer">
                          {recipe.name}
                        </Link>
                        <span className="text-sm font-bold">{recipe.velocity.toFixed(1)}/day</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue Champions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...data.performance]
                    .sort((a, b) => b.total_sales - a.total_sales)
                    .slice(0, 5)
                    .map((recipe, index) => (
                      <div key={recipe.id} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                          {index + 1}
                        </Badge>
                        <Link to="/recipes" className="text-sm flex-1 truncate hover:text-primary hover:underline transition-colors cursor-pointer">
                          {recipe.name}
                        </Link>
                        <span className="text-sm font-bold">${recipe.total_sales.toFixed(0)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cost & Margin Trends (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.cost_trends.slice(0, 30)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                    />
                    <YAxis />
                    <Tooltip 
                      labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="cost" stroke="#ef4444" name="Cost" strokeWidth={2} />
                    <Line type="monotone" dataKey="selling_price" stroke="#10b981" name="Price" strokeWidth={2} />
                    <Line type="monotone" dataKey="margin" stroke="#3b82f6" name="Margin %" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recipe Velocity Prediction</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-2">Next Week Forecast</p>
                  <p className="text-2xl font-bold">${data.predictions.next_week_revenue.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">
                    Confidence: {(data.predictions.confidence * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Predicted Top Sellers:</p>
                  <div className="flex flex-wrap gap-2">
                    {data.predictions.top_recipes.map(recipe => (
                      <Link key={recipe} to="/recipes">
                        <Badge variant="secondary" className="hover:bg-accent cursor-pointer transition-colors">
                          {recipe}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Benchmarks Tab */}
        <TabsContent value="benchmarks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Industry Benchmarks Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={data.benchmarks}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" />
                    <PolarRadiusAxis />
                    <Radar name="Your Restaurant" dataKey="restaurant_value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                    <Radar name="Industry Standard" dataKey="industry_standard" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
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
                    <span className="text-sm text-muted-foreground">Your Value</span>
                    <span className="text-lg font-bold">{benchmark.restaurant_value.toFixed(1)}{benchmark.metric.includes('%') ? '%' : ''}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Industry Standard</span>
                    <span className="text-lg">{benchmark.industry_standard.toFixed(1)}{benchmark.metric.includes('%') ? '%' : ''}</span>
                  </div>
                  <div className="pt-2 border-t">
                    <Badge variant={benchmark.performance === 'above' ? 'default' : benchmark.performance === 'at' ? 'secondary' : 'destructive'}>
                      {benchmark.performance === 'above' ? 'Above Standard' : benchmark.performance === 'at' ? 'At Standard' : 'Below Standard'}
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

        {/* Ingredients Tab */}
        <TabsContent value="ingredients" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top Cost Impact Ingredients</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.ingredient_impact.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="ingredient_name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Bar dataKey="total_cost" fill="#f59e0b" name="Total Cost" />
                    <Bar dataKey="optimization_potential" fill="#10b981" name="Savings Potential" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.ingredient_impact.slice(0, 8).map(ingredient => (
              <Card key={ingredient.ingredient_name}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{ingredient.ingredient_name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Cost</span>
                    <span className="font-medium">${ingredient.total_cost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Used in Recipes</span>
                    <span className="font-medium">{ingredient.recipes_used_in}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Usage Frequency</span>
                    <span className="font-medium">{ingredient.usage_frequency} times</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Savings Potential</span>
                    <span className="font-bold text-green-600">${ingredient.optimization_potential.toFixed(0)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
