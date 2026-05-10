import { Badge } from '@/components/ui/badge';

interface TimeOffTabBadgeProps {
  count: number;
}

export function TimeOffTabBadge({ count }: TimeOffTabBadgeProps) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <Badge className="ml-1 h-5 min-w-5 px-1.5 bg-warning text-warning-foreground text-[10px] font-bold animate-pulse">
      {count}
    </Badge>
  );
}
