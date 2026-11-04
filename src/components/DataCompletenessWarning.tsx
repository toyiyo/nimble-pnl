import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface DataCompletenessWarningProps {
  message: string;
  className?: string;
}

export const DataCompletenessWarning = ({ message, className }: DataCompletenessWarningProps) => {
  if (!message) return null;
  return (
    <output
      className={cn(
        'flex items-start gap-3 p-2.5 rounded-lg bg-warning/10 border border-warning/20',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
      <span className="text-[13px] text-foreground">{message}</span>
    </output>
  );
};
