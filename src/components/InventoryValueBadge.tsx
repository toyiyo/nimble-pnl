import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calculator, TrendingUp, Blend, HelpCircle } from 'lucide-react';

interface InventoryValueBadgeProps {
  calculationMethod: 'recipe-based' | 'estimated' | 'mixed';
  markupUsed?: number;
  category?: string;
}

export const InventoryValueBadge: React.FC<InventoryValueBadgeProps> = ({
  calculationMethod,
  markupUsed,
  category
}) => {
  const getIconAndColor = () => {
    switch (calculationMethod) {
      case 'recipe-based':
        return { icon: TrendingUp, variant: 'default' as const, label: 'Recipe-based' };
      case 'estimated':
        return { icon: Calculator, variant: 'secondary' as const, label: 'Estimated' };
      case 'mixed':
        return { icon: Blend, variant: 'outline' as const, label: 'Mixed' };
      default:
        return { icon: HelpCircle, variant: 'outline' as const, label: 'Unknown' };
    }
  };

  const getTooltipContent = () => {
    switch (calculationMethod) {
      case 'recipe-based':
        return "Value calculated from actual sales data and recipe costs. This is the most accurate valuation.";
      case 'estimated':
        return `Value estimated using ${markupUsed}x markup on unit cost${category ? ` for ${category} category` : ''}.`;
      case 'mixed':
        return "Value calculated using a combination of recipe data and estimated markup for missing components.";
      default:
        return "Calculation method unknown.";
    }
  };

  const { icon: Icon, variant, label } = getIconAndColor();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={variant} className="text-xs cursor-help">
            <Icon className="h-3 w-3 mr-1" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{getTooltipContent()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};