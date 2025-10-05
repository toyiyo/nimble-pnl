import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';

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
}

export function DashboardMetricCard({ 
  title, 
  value, 
  trend, 
  icon: Icon, 
  variant = 'default',
  subtitle 
}: DashboardMetricCardProps) {
  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.value > 0) return <TrendingUp className="h-4 w-4" />;
    if (trend.value < 0) return <TrendingDown className="h-4 w-4" />;
    return <Minus className="h-4 w-4" />;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.value > 0) return 'text-green-600 dark:text-green-400';
    if (trend.value < 0) return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return 'border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50/50 to-background dark:from-green-950/20';
      case 'warning':
        return 'border-yellow-200 dark:border-yellow-900 bg-gradient-to-br from-yellow-50/50 to-background dark:from-yellow-950/20';
      case 'danger':
        return 'border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50/50 to-background dark:from-red-950/20';
      default:
        return 'border-border bg-gradient-to-br from-card to-background';
    }
  };

  return (
    <Card className={`transition-all hover:shadow-lg ${getVariantStyles()}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
        {trend && (
          <div className={`flex items-center gap-1 text-xs mt-1 ${getTrendColor()}`}>
            {getTrendIcon()}
            <span className="font-medium">{Math.abs(trend.value)}%</span>
            <span className="text-muted-foreground">{trend.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
