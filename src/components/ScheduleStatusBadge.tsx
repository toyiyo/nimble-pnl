import { Badge } from '@/components/ui/badge';
import { Lock, FileEdit, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface ScheduleStatusBadgeProps {
  isPublished: boolean;
  publishedAt?: string | null;
  locked?: boolean;
  variant?: 'default' | 'compact';
}

export const ScheduleStatusBadge = ({
  isPublished,
  publishedAt,
  locked,
  variant = 'default',
}: ScheduleStatusBadgeProps) => {
  if (!isPublished) {
    return (
      <Badge
        variant="outline"
        className="bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border-yellow-500/30 text-yellow-700"
      >
        <FileEdit className="h-3 w-3 mr-1" />
        {variant === 'compact' ? 'Draft' : 'Draft Schedule'}
      </Badge>
    );
  }

  if (locked) {
    return (
      <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
        <Lock className="h-3 w-3 mr-1" />
        {variant === 'compact' ? 'Published' : 'Published & Locked'}
        {publishedAt && variant === 'default' && (
          <span className="ml-1 text-xs opacity-90">
            ({format(new Date(publishedAt), 'MMM d')})
          </span>
        )}
      </Badge>
    );
  }

  return (
    <Badge className="bg-gradient-to-r from-blue-500 to-indigo-600">
      <Clock className="h-3 w-3 mr-1" />
      Published
      {publishedAt && variant === 'default' && (
        <span className="ml-1 text-xs opacity-90">
          ({format(new Date(publishedAt), 'MMM d')})
        </span>
      )}
    </Badge>
  );
};
