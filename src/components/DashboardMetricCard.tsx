import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, LucideIcon, Sparkles } from 'lucide-react';
import { MetricIcon } from './MetricIcon';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface DashboardMetricCardProps {
  title: string;
  value: string | number;
  trend?: {
    value: number;
    label: string;
  };
  icon: LucideIcon;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  subtitle?: string;
  sparklineData?: Array<{ value: number }>;
  periodLabel?: string;
}

export function DashboardMetricCard({ 
  title, 
  value, 
  trend, 
  icon, 
  variant = 'default',
  subtitle,
  sparklineData,
  periodLabel
}: DashboardMetricCardProps) {
  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.value > 0) return <TrendingUp className="h-4 w-4" />;
    if (trend.value < 0) return <TrendingDown className="h-4 w-4" />;
    return <Minus className="h-4 w-4" />;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.value > 0) return 'text-success';
    if (trend.value < 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return 'border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50/50 via-background to-green-50/30 dark:from-green-950/20 dark:via-background dark:to-green-950/10';
      case 'warning':
        return 'border-yellow-200 dark:border-yellow-900 bg-gradient-to-br from-yellow-50/50 via-background to-yellow-50/30 dark:from-yellow-950/20 dark:via-background dark:to-yellow-950/10';
      case 'danger':
        return 'border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50/50 via-background to-red-50/30 dark:from-red-950/20 dark:via-background dark:to-red-950/10';
      default:
        return 'border-border bg-gradient-to-br from-card via-background to-muted/20';
    }
  };

  const getIconVariant = () => {
    switch (variant) {
      case 'success':
        return 'emerald';
      case 'warning':
        return 'amber';
      case 'danger':
        return 'red';
      default:
        return 'blue';
    }
  };

  const isExcellent = variant === 'success' && trend && trend.value > 5;

  return (
    <Card className={`group transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 animate-fade-in ${getVariantStyles()}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <MetricIcon icon={icon} variant={getIconVariant() as any} />
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="text-3xl font-bold tracking-tight flex items-center gap-2">
              {value}
              {isExcellent && (
                <Sparkles className="h-5 w-5 text-warning" aria-label="Excellent performance" />
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        
        {sparklineData && sparklineData.length > 0 && (
          <div className="mt-4 h-12 -mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        
        {trend && (
          <div className={`flex items-center gap-1.5 text-xs mt-3 pt-3 border-t ${getTrendColor()}`}>
            <div className="flex items-center gap-1">
              {getTrendIcon()}
              <span className="font-semibold">{Math.abs(trend.value).toFixed(1)}%</span>
            </div>
            <span className="text-muted-foreground">{trend.label}</span>
          </div>
        )}
        
        {periodLabel && (
          <div className="text-xs text-muted-foreground mt-2">
            {periodLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
