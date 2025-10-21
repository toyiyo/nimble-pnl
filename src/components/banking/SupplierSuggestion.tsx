import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SupplierSuggestion {
  supplier_id: string;
  supplier_name: string;
  match_confidence: number;
  match_type: string;
}

interface SupplierSuggestionProps {
  suggestions: SupplierSuggestion[];
  selectedSupplierId?: string;
  onSelectSupplier: (supplierId: string) => void;
  onCreateSupplier?: () => void;
}

export function SupplierSuggestion({
  suggestions,
  selectedSupplierId,
  onSelectSupplier,
  onCreateSupplier,
}: SupplierSuggestionProps) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  const getMatchTypeColor = (matchType: string) => {
    switch (matchType) {
      case 'exact':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'alias':
        return 'bg-secondary/50 text-secondary-foreground border-secondary/20';
      case 'fuzzy':
        return 'bg-muted text-muted-foreground border-border';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>Suggested Suppliers</span>
      </div>
      
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.supplier_id}
            onClick={() => onSelectSupplier(suggestion.supplier_id)}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-lg border transition-colors text-left",
              selectedSupplierId === suggestion.supplier_id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/50"
            )}
            aria-label={`Select supplier ${suggestion.supplier_name}`}
            aria-pressed={selectedSupplierId === suggestion.supplier_id}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-md",
                selectedSupplierId === suggestion.supplier_id 
                  ? "bg-primary/10" 
                  : "bg-muted"
              )}>
                <Building2 className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-medium">{suggestion.supplier_name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge 
                    variant="outline" 
                    className={cn("text-xs border", getMatchTypeColor(suggestion.match_type))}
                  >
                    {suggestion.match_type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(suggestion.match_confidence * 100)}% match
                  </span>
                </div>
              </div>
            </div>
            {selectedSupplierId === suggestion.supplier_id && (
              <Check className="h-5 w-5 text-primary" />
            )}
          </button>
        ))}
      </div>

      {onCreateSupplier && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onCreateSupplier}
          aria-label="Create a new supplier"
        >
          <Building2 className="h-4 w-4 mr-2" />
          Create New Supplier
        </Button>
      )}
    </div>
  );
}
