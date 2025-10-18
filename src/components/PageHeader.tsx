import { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MetricIcon } from '@/components/MetricIcon';

interface PageHeaderProps {
  icon: LucideIcon;
  iconVariant?: 'emerald' | 'amber' | 'blue' | 'purple' | 'pink' | 'red' | 'teal' | 'indigo';
  title: string;
  restaurantName?: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  icon,
  iconVariant = 'emerald',
  title,
  restaurantName,
  subtitle,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-background via-primary/5 to-accent/5 border-2 border-transparent bg-clip-padding rounded-lg p-6 ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent opacity-50" />
      <div className="relative">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <MetricIcon icon={icon} variant={iconVariant} />
            <div className="space-y-2">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                {title}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                {restaurantName && (
                  <Badge variant="outline" className="gap-1.5 px-3 py-1 font-medium">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    {restaurantName}
                  </Badge>
                )}
                {subtitle && (
                  <div className="text-sm text-muted-foreground">
                    {subtitle}
                  </div>
                )}
              </div>
            </div>
          </div>
          {actions && (
            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
