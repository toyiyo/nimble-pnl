import { Badge } from '@/components/ui/badge';
import { LucideIcon, CheckCircle2, Loader2, AlertCircle, Scan, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScannerStatusBadgeProps {
  status: 'ready' | 'scanning' | 'success' | 'error' | 'processing' | 'ai-mode';
  message?: string;
  className?: string;
}

const statusConfig: Record<ScannerStatusBadgeProps['status'], {
  icon: LucideIcon;
  label: string;
  className: string;
}> = {
  ready: {
    icon: CheckCircle2,
    label: 'Ready',
    className: 'bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 animate-pulse',
  },
  scanning: {
    icon: Scan,
    label: 'Scanning',
    className: 'bg-gradient-to-r from-blue-500/20 to-blue-600/20 text-blue-700 dark:text-blue-300 border-blue-500/30',
  },
  success: {
    icon: CheckCircle2,
    label: 'Scanned!',
    className: 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-500/30 animate-in zoom-in duration-300',
  },
  error: {
    icon: AlertCircle,
    label: 'Error',
    className: 'bg-gradient-to-r from-red-500/20 to-orange-500/20 text-red-700 dark:text-red-300 border-red-500/30',
  },
  processing: {
    icon: Loader2,
    label: 'Processing',
    className: 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  'ai-mode': {
    icon: Zap,
    label: 'AI Mode',
    className: 'bg-gradient-to-r from-purple-500 to-purple-600 text-white border-purple-600 shadow-lg shadow-purple-500/30',
  },
};

export function ScannerStatusBadge({ status, message, className }: ScannerStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        'flex items-center gap-1.5 px-3 py-1 font-medium transition-all duration-300',
        config.className,
        className
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', status === 'processing' && 'animate-spin')} />
      <span>{message || config.label}</span>
    </Badge>
  );
}
