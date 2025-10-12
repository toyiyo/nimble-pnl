import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RecipeConversionStatusBadgeProps {
  hasIssues: boolean;
  issueCount?: number;
  size?: 'sm' | 'md';
  showText?: boolean;
}

export function RecipeConversionStatusBadge({ 
  hasIssues, 
  issueCount = 0,
  size = 'md',
  showText = true 
}: RecipeConversionStatusBadgeProps) {
  if (!hasIssues) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className="bg-green-50 border-green-300 text-green-700 gap-1"
            >
              <CheckCircle2 className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
              {showText && <span>Conversions OK</span>}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>All ingredient conversions are properly configured</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className="bg-amber-50 border-amber-300 text-amber-700 gap-1"
          >
            <AlertTriangle className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
            {showText && (
              <span>
                {issueCount} Conversion {issueCount === 1 ? 'Issue' : 'Issues'}
              </span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {issueCount} ingredient{issueCount === 1 ? '' : 's'} {issueCount === 1 ? 'has' : 'have'} conversion issues.
            <br />
            Will use 1:1 deduction ratio as fallback.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
