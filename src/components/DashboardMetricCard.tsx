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
  sparklineData?: Array<{ value: number }>;
  periodLabel?: string;
}

export function DashboardMetricCard({
  title,
  value,
  trend,
  icon: Icon,
  variant = 'default',
  subtitle,
  sparklineData,
  periodLabel
}: DashboardMetricCardProps) {
  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.value > 0) return <TrendingUp className="h-3.5 w-3.5" />;
    if (trend.value < 0) return <TrendingDown className="h-3.5 w-3.5" />;
    return <Minus className="h-3.5 w-3.5" />;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.value > 0) return 'text-green-600';
    if (trend.value < 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  const getAccentColor = () => {
    switch (variant) {
      case 'success': return 'text-green-600';
      case 'warning': return 'text-orange-500';
      case 'danger': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="group flex flex-col justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[13px] text-muted-foreground leading-tight pr-2">{title}</p>
        <div className={`h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 ${getAccentColor()}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div>
        <p className="text-[22px] font-semibold tracking-tight text-foreground">{value}</p>
        {subtitle && (
          <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>

      {trend && (
        <div className={`flex items-center gap-1 text-[12px] mt-3 pt-3 border-t border-border/40 ${getTrendColor()}`}>
          {getTrendIcon()}
          <span className="font-medium">{Math.abs(trend.value).toFixed(1)}%</span>
          <span className="text-muted-foreground">{trend.label}</span>
        </div>
      )}

      {periodLabel && !trend && (
        <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border/40">
          {periodLabel}
        </p>
      )}
    </div>
  );
}
