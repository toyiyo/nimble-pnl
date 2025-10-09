import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSupplierPriceAnalytics } from '@/hooks/useSupplierPriceAnalytics';
import { TrendingUp, TrendingDown, AlertCircle, DollarSign, Package, Activity } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface SupplierPriceAnalysisReportProps {
  restaurantId: string;
}

export function SupplierPriceAnalysisReport({ restaurantId }: SupplierPriceAnalysisReportProps) {
  const { productPricing, supplierMetrics, loading } = useSupplierPriceAnalytics(restaurantId);

  const insights = useMemo(() => {
    if (!productPricing.length) return null;

    const avgPriceChange = productPricing.reduce((sum, p) => sum + p.price_change_30d, 0) / productPricing.length;
    const totalPotentialSavings = productPricing.reduce((sum, p) => sum + p.potential_savings, 0);
    const highVolatilityProducts = productPricing.filter(p => p.volatility > 15).length;
    const topIncreases = [...productPricing].sort((a, b) => b.price_change_30d - a.price_change_30d).slice(0, 5);
    const topDecreases = [...productPricing].sort((a, b) => a.price_change_30d - b.price_change_30d).slice(0, 5);
    const savingsOpportunities = [...productPricing]
      .filter(p => p.potential_savings > 0 && p.supplier_count > 1)
      .sort((a, b) => b.potential_savings - a.potential_savings)
      .slice(0, 10);

    return {
      avgPriceChange,
      totalPotentialSavings,
      highVolatilityProducts,
      topIncreases,
      topDecreases,
      savingsOpportunities,
    };
  }, [productPricing]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!insights || productPricing.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Pricing Data Available</CardTitle>
          <CardDescription>
            Start tracking purchases to see supplier pricing insights
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Price Change (30d)</CardTitle>
            {insights.avgPriceChange >= 0 ? (
              <TrendingUp className="h-4 w-4 text-red-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-green-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights.avgPriceChange >= 0 ? '+' : ''}
              {insights.avgPriceChange.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Across {productPricing.length} products
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Potential Savings</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${insights.totalPotentialSavings.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              By switching to cheaper suppliers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Volatility Items</CardTitle>
            <Activity className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{insights.highVolatilityProducts}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Products with price swings &gt;15%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Suppliers</CardTitle>
            <Package className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{supplierMetrics.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Tracked in last 90 days
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Price Movers */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-red-500" />
              Biggest Price Increases (30d)
            </CardTitle>
            <CardDescription>Products with the largest price hikes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.topIncreases.map((product) => (
                <div key={product.product_id} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.product_name}</p>
                    <p className="text-sm text-muted-foreground">
                      ${product.current_price.toFixed(2)} per unit
                    </p>
                  </div>
                  <Badge variant="destructive">
                    +{product.price_change_30d.toFixed(1)}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-green-500" />
              Biggest Price Decreases (30d)
            </CardTitle>
            <CardDescription>Products with the largest price drops</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.topDecreases.map((product) => (
                <div key={product.product_id} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.product_name}</p>
                    <p className="text-sm text-muted-foreground">
                      ${product.current_price.toFixed(2)} per unit
                    </p>
                  </div>
                  <Badge variant="default" className="bg-green-500">
                    {product.price_change_30d.toFixed(1)}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Savings Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            Cost Savings Opportunities
          </CardTitle>
          <CardDescription>
            Save money by switching to your cheapest supplier for these items
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Current Price</TableHead>
                <TableHead>Cheapest Supplier</TableHead>
                <TableHead>Most Expensive</TableHead>
                <TableHead className="text-right">Potential Savings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {insights.savingsOpportunities.map((product) => (
                <TableRow key={product.product_id}>
                  <TableCell className="font-medium">{product.product_name}</TableCell>
                  <TableCell>${product.current_price.toFixed(2)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {product.cheapest_supplier}
                      <Badge variant="outline" className="text-green-600">Cheapest</Badge>
                    </div>
                  </TableCell>
                  <TableCell>{product.most_expensive_supplier}</TableCell>
                  <TableCell className="text-right font-bold text-green-600">
                    ${product.potential_savings.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Price Volatility Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            Price Volatility by Category
          </CardTitle>
          <CardDescription>
            Categories with the most price fluctuations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={Object.entries(
                productPricing.reduce((acc, p) => {
                  if (!acc[p.category]) acc[p.category] = [];
                  acc[p.category].push(p.volatility);
                  return acc;
                }, {} as Record<string, number[]>)
              ).map(([category, volatilities]) => ({
                category,
                avgVolatility: volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length,
                count: volatilities.length,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" />
              <YAxis label={{ value: 'Volatility %', angle: -90, position: 'insideLeft' }} />
              <Tooltip 
                formatter={(value: number) => `${value.toFixed(1)}%`}
                labelFormatter={(label) => `Category: ${label}`}
              />
              <Bar dataKey="avgVolatility" fill="hsl(var(--primary))" name="Avg Volatility" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Supplier Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Supplier Performance
          </CardTitle>
          <CardDescription>
            Track your suppliers' pricing trends and reliability
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Avg Price Change (30d)</TableHead>
                <TableHead>Total Purchases</TableHead>
                <TableHead className="text-right">Reliability Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierMetrics
                .sort((a, b) => b.reliability_score - a.reliability_score)
                .map((supplier) => (
                  <TableRow key={supplier.supplier_id}>
                    <TableCell className="font-medium">{supplier.supplier_name}</TableCell>
                    <TableCell>{supplier.product_count}</TableCell>
                    <TableCell>
                      <span className={supplier.avg_price_change >= 0 ? 'text-red-600' : 'text-green-600'}>
                        {supplier.avg_price_change >= 0 ? '+' : ''}
                        {supplier.avg_price_change.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>{supplier.total_purchases}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">
                        {supplier.reliability_score.toFixed(0)}/100
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Price Trend Alert */}
      {insights.avgPriceChange > 5 && (
        <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <AlertCircle className="h-5 w-5" />
              Price Increase Alert
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Your average product costs have increased by{' '}
              <span className="font-bold">{insights.avgPriceChange.toFixed(1)}%</span> in the last 30 days.
              Consider reviewing your supplier contracts and exploring alternative options to control costs.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
