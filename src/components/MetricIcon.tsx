import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricIconProps {
  icon: LucideIcon;
  variant?: 'emerald' | 'amber' | 'blue' | 'purple' | 'pink' | 'red' | 'teal' | 'indigo';
  className?: string;
}

export function MetricIcon({ icon: Icon, variant = 'emerald', className }: MetricIconProps) {
  const gradientClasses = {
    emerald: 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30',
    amber: 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/30',
    blue: 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/30',
    purple: 'bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg shadow-purple-500/30',
    pink: 'bg-gradient-to-br from-pink-500 to-pink-600 shadow-lg shadow-pink-500/30',
    red: 'bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30',
    teal: 'bg-gradient-to-br from-teal-500 to-teal-600 shadow-lg shadow-teal-500/30',
    indigo: 'bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/30',
  };

  return (
    <div className={cn(
      'rounded-lg p-2.5 transition-all duration-300 hover:scale-110 hover:shadow-xl',
      gradientClasses[variant],
      className
    )}>
      <Icon className="h-5 w-5 text-white" />
    </div>
  );
}
