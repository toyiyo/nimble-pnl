import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface DataCompletenessWarningProps {
  message: string;
  className?: string;
}

export const DataCompletenessWarning = ({ message, className }: DataCompletenessWarningProps) => {
  if (!message) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-[13px] text-foreground">{message}</p>
    </div>
  );
};
