import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

interface AIConfidenceBadgeProps {
  confidence: 'high' | 'medium' | 'low';
  reasoning: string | null;
}

export function AIConfidenceBadge({ confidence, reasoning }: AIConfidenceBadgeProps) {
  const isMobile = useIsMobile();

  const confidenceStyles = {
    high: "bg-success/10 text-success border-success/30 hover:bg-success/20",
    medium: "bg-warning/10 text-warning border-warning/30 hover:bg-warning/20",
    low: "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
  };

  const confidenceLabels = {
    high: "High Confidence",
    medium: "Medium Confidence",
    low: "Low Confidence"
  };

  // Mobile: use drawer for reasoning details
  if (isMobile && reasoning) {
    return (
      <Drawer>
        <DrawerTrigger asChild>
          <button 
            className="flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary rounded"
            aria-label={`Confidence: ${confidenceLabels[confidence]}. Tap for AI reasoning details.`}
          >
            <Badge 
              variant="outline"
              className={confidenceStyles[confidence]}
            >
              {confidenceLabels[confidence]}
            </Badge>
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              AI Categorization Details
            </DrawerTitle>
            <DrawerDescription>
              Why AI suggested this category
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <div className="mb-3">
              <span className="text-sm font-medium text-muted-foreground">Confidence Level:</span>
              <div className="mt-1">
                <Badge 
                  variant="outline"
                  className={confidenceStyles[confidence]}
                >
                  {confidenceLabels[confidence]}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-sm font-medium text-muted-foreground">Reasoning:</span>
              <p className="mt-1 text-sm">{reasoning}</p>
            </div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: use tooltip for reasoning
  if (!isMobile && reasoning) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Badge 
                  variant="outline"
                  className={confidenceStyles[confidence]}
                >
                  {confidenceLabels[confidence]}
                </Badge>
              </div>
            </TooltipTrigger>
            <TooltipContent 
              side="top" 
              className="max-w-xs"
            >
              <p className="text-sm">{reasoning}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info 
                className="h-3.5 w-3.5 text-muted-foreground cursor-help" 
                aria-label="AI reasoning information"
              />
            </TooltipTrigger>
            <TooltipContent 
              side="top" 
              className="max-w-xs"
            >
              <p className="text-sm font-medium mb-1">AI Reasoning:</p>
              <p className="text-sm">{reasoning}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }

  // No reasoning available - just show badge
  return (
    <Badge 
      variant="outline"
      className={confidenceStyles[confidence]}
    >
      {confidenceLabels[confidence]}
    </Badge>
  );
}
